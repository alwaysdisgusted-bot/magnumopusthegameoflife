/* eslint-disable @typescript-eslint/no-require-imports -- Node's test runner loads this CommonJS VM fixture. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../public/desktop.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function eventTarget(value = {}) {
  const listeners = new Map();
  return Object.assign(value, {
    addEventListener(type, callback, options) { const list = listeners.get(type) || []; list.push({ callback, once: !!options?.once }); listeners.set(type, list); },
    fire(type, event = {}) { for (const entry of [...(listeners.get(type) || [])]) { if (entry.once) listeners.set(type, (listeners.get(type) || []).filter(item => item !== entry)); entry.callback(event); } }
  });
}
function node() { return eventTarget({ textContent: '', innerHTML: '', src: '', disabled: false, hidden: false }); }
function childWindow() {
  const elements = new Map(['.mo-companion-name', '.mo-companion-wizard', '.mo-companion-mode', '[data-companion-back]', '[data-companion-close]'].map(selector => [selector, node()]));
  let bodyWrites = 0, markup = '';
  const body = { className: '' };
  Object.defineProperty(body, 'innerHTML', { get: () => markup, set(value) { markup = value; bodyWrites++; } });
  const doc = eventTarget({ documentElement: {}, title: '', body, head: { children: [], appendChild(value) { this.children.push(value); } }, createElement: () => node(), querySelector: selector => elements.get(selector) || null });
  const child = eventTarget({ document: doc, closed: false, closes: 0, focuses: 0,
    close() { this.closes++; this.closed = true; this.fire('pagehide'); }, focus() { this.focuses++; } });
  return { child, doc, elements, get bodyWrites() { return bodyWrites; } };
}
function fixture(options = {}) {
  let user = { id: 'A' }, gesture = false;
  const profile = { name: 'Magnum Bot', equipped: 'midnight' }, toasts = [], pipCalls = [], popupCalls = [], children = [];
  const controlNodes = new Map(['[data-action="desktop-open"]', '[data-desktop-open-label]', '[data-action="desktop-close"]', '[data-action="desktop-popup"]', '[data-desktop-status]', '.mo-desktop-preview img'].map(selector => [selector, node()]));
  const card = { querySelector: selector => controlNodes.get(selector) || null };
  const document = { querySelectorAll: selector => selector === '[data-desktop-controls]' ? [card] : [] };
  const makeChild = () => { const value = childWindow(); children.push(value); return value.child; };
  const window = eventTarget({ location: { href: 'https://magnum.test/game/#profile' }, focuses: 0, focus() { this.focuses++; },
    MOAuth: { getAccount: () => user, isAuthenticated: () => !!user },
    MOApp: { state: { profile }, esc: escape, icon: () => '<svg></svg>', toast: message => toasts.push(message),
      commit() { throw new Error('A desktop companion must not change a game save'); } },
    open(url, target, features) { popupCalls.push({ url, target, features, gesture }); return options.blockPopup ? null : makeChild(); }
  });
  if (options.pip !== false) window.documentPictureInPicture = { requestWindow(config) { pipCalls.push({ width: config.width, height: config.height, gesture }); return options.request ? options.request(makeChild) : Promise.resolve(makeChild()); } };
  vm.runInNewContext(source, { window, document, URL, Promise });
  return { module: window.MODesktop, window, document, profile, toasts, pipCalls, popupCalls, children, controlNodes,
    setUser(id) { user = id ? { id } : null; }, makeChild,
    click(action) { gesture = true; try { return window.MODesktop.handleAction(action); } finally { gesture = false; } }
  };
}

test('a click requests floating mode before yielding and supplies both initial dimensions', async () => {
  const pending = deferred(), f = fixture({ request: () => pending.promise });
  assert.equal(f.click('desktop-open'), true);
  assert.equal(f.pipCalls.length, 1); assert.equal(f.pipCalls[0].gesture, true);
  assert.ok(f.pipCalls[0].width > 0 && f.pipCalls[0].height > 0);
  assert.equal(f.controlNodes.get('[data-action="desktop-open"]').disabled, true);
  pending.resolve(f.makeChild()); await flush();
  assert.equal(f.controlNodes.get('[data-action="desktop-open"]').disabled, false);
  assert.match(f.controlNodes.get('[data-desktop-status]').textContent, /nad aplikáciami/);
});

test('concurrent clicks create one window and reopening focuses the existing companion', async () => {
  const pending = deferred(), f = fixture({ request: () => pending.promise });
  f.click('desktop-open'); f.click('desktop-open'); assert.equal(f.pipCalls.length, 1);
  pending.resolve(f.makeChild()); await flush();
  const child = f.children[0].child, focuses = child.focuses;
  assert.equal(await f.module.open(), true); assert.equal(f.pipCalls.length, 1); assert.equal(child.focuses, focuses + 1);
});

test('names are assigned as text and only fixed outfit fragments enter the artwork URL', async () => {
  const f = fixture(); f.profile.name = '<img src=x onerror=alert(1)> & čarodej';
  await f.module.open(); const view = f.children[0];
  assert.equal(view.elements.get('.mo-companion-name').textContent, f.profile.name);
  assert.equal(view.elements.get('.mo-companion-name').innerHTML, ''); assert.doesNotMatch(view.doc.body.innerHTML, /onerror|alert\(1\)/);
  for (const [outfit, fragment] of [['rose', '#rose'], ['forest', '#forest'], ['midnight', '#cobalt'], ['unknown', ''], ['constructor', ''], ['__proto__', '']]) {
    f.profile.equipped = outfit; f.module.afterRender();
    assert.equal(view.elements.get('.mo-companion-wizard').src, 'https://magnum.test/game/assets/wizard.svg' + fragment, outfit);
  }
});

test('rendering another game section refreshes name and costume without replacing child controls', async () => {
  const f = fixture(); await f.module.open(); const view = f.children[0], closeButton = view.elements.get('[data-companion-close]');
  f.profile.name = 'Nové meno'; f.profile.equipped = 'forest'; f.module.afterRender('shop');
  assert.equal(view.elements.get('.mo-companion-name').textContent, 'Nové meno');
  assert.match(view.elements.get('.mo-companion-wizard').src, /wizard\.svg#forest$/);
  assert.equal(view.elements.get('[data-companion-close]'), closeButton); assert.equal(view.bodyWrites, 1);
});

test('close controls and Escape close the companion, while back-to-game focuses its opener', async () => {
  const f = fixture(); await f.module.open(); const first = f.children[0];
  first.elements.get('[data-companion-back]').fire('click'); assert.equal(f.window.focuses, 1);
  first.elements.get('[data-companion-close]').fire('click'); assert.equal(first.child.closed, true);
  await f.module.open(); const second = f.children[1]; let prevented = false;
  second.doc.fire('keydown', { key: 'Escape', preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(second.child.closed, true);
  assert.equal(f.controlNodes.get('[data-action="desktop-close"]').hidden, true);
});

test('logout or an account change closes the previous account companion', async () => {
  for (const next of [null, 'B']) {
    const f = fixture(); await f.module.open(); const child = f.children[0].child;
    f.setUser(next); f.module.afterRender('profile'); assert.equal(child.closed, true, String(next));
    assert.equal(f.controlNodes.get('[data-action="desktop-close"]').hidden, true);
    if (!next) assert.equal(f.module.controls(), '');
  }
});

test('a pending floating request cannot reopen a companion after logout and destroy', async () => {
  const pending = deferred(), f = fixture({ request: () => pending.promise });
  const opening = f.module.open(); f.setUser(null); f.module.destroy(); const child = f.makeChild();
  pending.resolve(child); assert.equal(await opening, false); assert.equal(child.closed, true);
  assert.equal(f.controlNodes.get('[data-action="desktop-open"]').disabled, false);
  assert.equal(f.toasts.length, 0);
});

test('a request resolving after an account switch closes its stale result', async () => {
  const pending = deferred(), f = fixture({ request: () => pending.promise });
  const opening = f.module.open(); f.setUser('B'); f.module.afterRender('profile'); const child = f.makeChild();
  pending.resolve(child); assert.equal(await opening, false); assert.equal(child.closed, true);
  assert.equal(f.controlNodes.get('[data-action="desktop-open"]').disabled, false);
});

test('a browser without floating support opens an ordinary window directly on the click', async () => {
  const f = fixture({ pip: false }); f.click('desktop-open'); await flush();
  assert.equal(f.popupCalls.length, 1); assert.equal(f.popupCalls[0].gesture, true);
  assert.equal(f.popupCalls[0].url, 'about:blank'); assert.match(f.popupCalls[0].features, /popup=yes/);
  assert.doesNotMatch(f.popupCalls[0].url + f.popupCalls[0].features, /Magnum|token|password|account/i);
  assert.match(f.children[0].elements.get('.mo-companion-mode').textContent, /Obyčajné okno/);
  assert.match(f.controlNodes.get('[data-desktop-status]').textContent, /nemusí zostať nad/);
});

test('blocked ordinary windows expose a retry and a useful popup permission message', async () => {
  const f = fixture({ pip: false, blockPopup: true }); assert.equal(await f.module.open(), false);
  assert.equal(f.children.length, 0); assert.equal(f.controlNodes.get('[data-action="desktop-popup"]').hidden, false);
  assert.match(f.toasts[0], /Povoľ vyskakovacie okná/); assert.equal(f.controlNodes.get('[data-action="desktop-open"]').disabled, false);
});

test('rejected floating requests require an explicit new popup click instead of opening one automatically', async () => {
  const f = fixture({ request: () => Promise.reject(new Error('Denied')) }); assert.equal(await f.module.open(), false);
  assert.equal(f.popupCalls.length, 0); assert.equal(f.controlNodes.get('[data-action="desktop-popup"]').hidden, false);
  f.click('desktop-popup'); await flush(); assert.equal(f.popupCalls.length, 1); assert.equal(f.popupCalls[0].gesture, true);
  assert.equal(f.pipCalls.length, 1); assert.equal(f.controlNodes.get('[data-action="desktop-popup"]').hidden, true);
});

test('an already-closed floating result exposes explicit fallback without changing the game', async () => {
  const f = fixture({ request(makeChild) { const child = makeChild(); child.closed = true; return Promise.resolve(child); } });
  const before = JSON.stringify(f.window.MOApp.state);
  assert.equal(await f.module.open(), false);
  assert.equal(f.children[0].bodyWrites, 0); assert.equal(f.children[0].child.focuses, 0);
  assert.equal(f.controlNodes.get('[data-action="desktop-popup"]').hidden, false);
  assert.equal(f.controlNodes.get('[data-action="desktop-close"]').hidden, true);
  assert.equal(f.controlNodes.get('[data-action="desktop-open"]').disabled, false);
  assert.equal(f.popupCalls.length, 0); assert.match(f.toasts[0], /Môžeš skúsiť obyčajné okno/);
  assert.equal(JSON.stringify(f.window.MOApp.state), before);
});

test('closing the child resets its controls, and closing the parent also closes an ordinary companion', async () => {
  const f = fixture({ pip: false }); await f.module.open(); const first = f.children[0].child;
  first.closed = true; first.fire('pagehide'); assert.equal(f.controlNodes.get('[data-action="desktop-close"]').hidden, true);
  await f.module.open(); const second = f.children[1].child; assert.equal(second.closed, false);
  f.window.fire('pagehide'); assert.equal(second.closed, true); assert.equal(first.closes, 0);
});

test('navigating an ordinary child to another origin cannot break later game renders', async () => {
  const f = fixture({ pip: false }); await f.module.open(); const child = f.children[0].child;
  Object.defineProperty(child, 'document', { configurable: true, get() { const error = new Error('Cross-origin access denied'); error.name = 'SecurityError'; throw error; } });
  assert.doesNotThrow(() => f.module.afterRender('library'));
  assert.equal(f.controlNodes.get('[data-action="desktop-close"]').hidden, true);
  assert.equal(await f.module.open(), true); assert.equal(f.children.length, 2);
});

test('unrelated actions pass through and signed-out visitors cannot open a companion', async () => {
  const f = fixture(); assert.equal(f.module.handleAction('add-book'), false); assert.equal(f.pipCalls.length + f.popupCalls.length, 0);
  f.setUser(null); assert.equal(f.module.controls(), ''); assert.equal(await f.module.open(), false);
  assert.equal(f.pipCalls.length + f.popupCalls.length, 0); assert.equal(f.toasts.length, 0);
});
