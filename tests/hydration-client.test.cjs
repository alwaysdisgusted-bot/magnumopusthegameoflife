/* eslint-disable @typescript-eslint/no-require-imports -- Node's test runner loads this CommonJS VM fixture. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const MINUTE = 60000, PREFIX = 'magnum-opus:hydration:';
function fixture(options = {}) {
  let user = { id: 'A' }, now = 100000, serial = 0, modalOpen = false, failStorage = !!options.failStorage;
  const timers = new Map(), saved = new Map(Object.entries(options.saved || {})), docListeners = {}, winListeners = {};
  const rendered = [], toasts = [], writes = [], main = { children: [], getBoundingClientRect: () => ({ left: 280, right: 1280, top: 0 }), appendChild(node) { node.isConnected = true; this.children.push(node); } };
  const document = { hidden: false, activeElement: null, getElementById: id => id === 'main' ? main : main.children.find(node => node.id === id && node.isConnected),
    querySelector: selector => selector === '.mobile-bar' ? options.mobileBar || null : modalOpen ? { open: true } : null,
    createElement() { return { style: {}, isConnected: false, attributes: {}, contains(node) { return !!node && node.hydrationButton === true; }, setAttribute(key, value) { this.attributes[key] = value; }, remove() { this.isConnected = false; } }; },
    addEventListener(type, fn) { docListeners[type] = fn; }, removeEventListener(type) { delete docListeners[type]; } };
  const window = { innerWidth: 1280, innerHeight: 900, MOAuth: { getAccount: () => user, isAuthenticated: () => !!user },
    MOApp: { render() { rendered.push(true); }, toast(message) { toasts.push(message); }, commit() { throw new Error('Hydration must never change game state'); } },
    addEventListener(type, fn) { winListeners[type] = fn; }, removeEventListener(type) { delete winListeners[type]; } };
  const localStorage = { getItem(key) { if (failStorage) throw new Error('Storage denied'); return saved.get(key) || null; }, setItem(key, value) { if (failStorage) throw new Error('Storage denied'); saved.set(key, value); writes.push({ key, value }); } };
  class Clock extends Date { static now() { return now; } }
  const math = Object.create(Math); math.random = () => options.random === undefined ? 0 : options.random;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/hydration.js'), 'utf8'), { window, document, localStorage, Date: Clock, Math: math, Set,
    setTimeout(fn, ms) { const id = ++serial; timers.set(id, { fn, due: now + ms }); return id; }, clearTimeout(id) { timers.delete(id); } });
  function fire(target, type, data = {}) { const fn = (target === 'document' ? docListeners : winListeners)[type]; if (fn) fn(Object.assign({ type, target: { closest: () => null } }, data)); }
  function advance(ms) {
    const target = now + ms; let steps = 0;
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break; if (++steps > 1000) throw new Error('Timer loop'); now = next[1].due; timers.delete(next[0]); next[1].fn();
    }
    now = target;
  }
  return { module: window.MOHydration, document, window, saved, timers, writes, rendered, toasts, main, fire, advance,
    banner: () => main.children.find(node => node.isConnected), setUser(id) { user = id ? { id } : null; }, setModal(value) { modalOpen = value; }, setStorageFailure(value) { failStorage = value; },
    preference(id = 'A') { return JSON.parse(saved.get(PREFIX + id) || 'null'); }, now: () => now, docListeners, winListeners };
}

test('first automatic nudge waits the random 20–40 minute interval and stays inside the main area', () => {
  const f = fixture({ random: .5 }); f.module.afterRender('library');
  f.advance(30 * MINUTE - 1); assert.equal(f.banner(), undefined); f.advance(1);
  assert.match(f.banner().innerHTML, /MALÁ PRIPOMIENKA/); assert.equal(f.banner().attributes.role, 'status');
  assert.equal(f.banner().style.left, '292px'); assert.equal(f.banner().style.bottom, '16px');
  assert.equal(f.preference().nextAt, f.now() + 30 * MINUTE);
  f.advance(45000); assert.equal(f.banner(), undefined); assert.equal(f.timers.size, 1);
});

test('initial timing supports both ends of the random interval and never immediately catches up an old session', () => {
  for (const [random, minutes] of [[0, 20], [.999999, 39.99998]]) {
    const f = fixture({ random, saved: { [PREFIX + 'A']: JSON.stringify({ enabled: true, nextAt: 1 }) } });
    f.module.afterRender('village'); f.advance(minutes * MINUTE - 1); assert.equal(f.banner(), undefined); f.advance(2); assert.ok(f.banner());
  }
});

test('open dialogs, editing fields, contenteditable and held drawing pointers defer the nudge without losing it', () => {
  for (const guard of ['dialog', 'input', 'editable', 'drawing']) {
    const f = fixture(); f.module.afterRender('desk');
    if (guard === 'dialog') f.setModal(true);
    if (guard === 'input' || guard === 'editable') f.document.activeElement = { closest: selector => selector.includes('contenteditable') ? {} : null };
    if (guard === 'drawing') f.fire('document', 'pointerdown', { pointerId: 7, target: { closest: () => ({}) } });
    f.advance(20 * MINUTE); assert.equal(f.banner(), undefined, guard);
    f.setModal(false); f.document.activeElement = null; f.fire('document', 'pointerup', { pointerId: 7 });
    f.advance(MINUTE); assert.ok(f.banner(), guard);
  }
});

test('typing and beginning a desk gesture remove a visible nudge and recent interaction postpones new ones', () => {
  const f = fixture(); f.module.afterRender('workspace'); f.advance(20 * MINUTE - 1000);
  f.fire('document', 'input'); f.advance(1000); assert.equal(f.banner(), undefined); f.advance(MINUTE); assert.ok(f.banner());
  f.fire('document', 'pointerdown', { pointerId: 1, target: { closest: () => ({}) } }); assert.equal(f.banner(), undefined);
  f.fire('document', 'pointerup', { pointerId: 1 });
  f.module.handleAction('hydration-preview'); assert.ok(f.banner()); f.module.pause(); assert.equal(f.banner(), undefined);
});

test('background tabs cancel timers and cannot display automatic or preview nudges', () => {
  const f = fixture(); f.module.afterRender('gym'); f.document.hidden = true; f.fire('document', 'visibilitychange');
  assert.equal(f.timers.size, 0); f.advance(50 * MINUTE); f.module.handleAction('hydration-preview'); assert.equal(f.banner(), undefined);
  f.document.hidden = false; f.fire('document', 'visibilitychange'); f.advance(20 * MINUTE - 1); assert.equal(f.banner(), undefined); f.advance(1); assert.ok(f.banner());
});

test('closing postpones for 30 minutes and updates the shared account cooldown', () => {
  const f = fixture(); f.module.afterRender('village'); f.module.handleAction('hydration-preview'); assert.ok(f.banner());
  f.module.handleAction('hydration-dismiss'); assert.equal(f.banner(), undefined); assert.equal(f.preference().nextAt, f.now() + 30 * MINUTE);
  f.advance(30 * MINUTE - 1); assert.equal(f.banner(), undefined); f.advance(1); assert.ok(f.banner());
});

test('disabled preferences persist, preview never enables them, and enabling starts a fresh delay', () => {
  const f = fixture({ saved: { [PREFIX + 'A']: JSON.stringify({ enabled: false, nextAt: 0 }) } });
  f.module.afterRender('settings'); assert.match(f.module.controls(), /Pripomienky: vypnuté/); assert.match(f.module.controls(), /hydration-preview" disabled/);
  f.module.handleAction('hydration-preview'); f.advance(100 * MINUTE); assert.equal(f.banner(), undefined); assert.equal(f.preference().enabled, false);
  f.module.handleAction('hydration-toggle'); assert.equal(f.preference().enabled, true); f.advance(20 * MINUTE); assert.ok(f.banner());
  f.module.handleAction('hydration-disable'); assert.equal(f.preference().enabled, false); assert.equal(f.banner(), undefined); assert.equal(f.timers.size, 0);
});

test('account switches remove old nudges, keep preferences separate and never write game saves or APIs', () => {
  const f = fixture(); f.module.afterRender('village'); f.module.handleAction('hydration-preview'); assert.ok(f.banner());
  f.module.handleAction('hydration-disable'); f.setUser('B'); f.module.afterRender('bank');
  assert.equal(f.banner(), undefined); assert.equal(f.preference('A').enabled, false); assert.equal(f.preference('B').enabled, true);
  f.advance(20 * MINUTE); assert.ok(f.banner()); f.setUser('A'); f.module.afterRender('profile'); assert.equal(f.banner(), undefined);
  f.advance(40 * MINUTE); assert.equal(f.banner(), undefined); assert.ok(f.writes.every(write => write.key.startsWith(PREFIX)));
});

test('signing out cancels the existing timer even when its callback runs before another render', () => {
  const f = fixture(); f.module.afterRender('village'); f.setUser(null); f.advance(20 * MINUTE);
  assert.equal(f.banner(), undefined); assert.equal(f.timers.size, 0); assert.equal(f.module.controls(), '');
});

test('storage failures keep the app usable and clearly disclose session-only settings', () => {
  const f = fixture({ failStorage: true }); assert.doesNotThrow(() => f.module.afterRender('settings'));
  assert.match(f.module.controls(), /len v tomto otvorenom okne/); f.module.handleAction('hydration-preview'); assert.ok(f.banner());
  f.module.handleAction('hydration-disable'); f.advance(60 * MINUTE); assert.equal(f.banner(), undefined);
});

test('another tab can disable nudges or extend the cooldown without exposing another account', () => {
  const f = fixture(); f.module.afterRender('settings'); f.module.handleAction('hydration-preview');
  f.fire('window', 'storage', { key: PREFIX + 'B', newValue: JSON.stringify({ enabled: false }) }); assert.ok(f.banner());
  f.saved.set(PREFIX + 'A', JSON.stringify({ enabled: false, nextAt: 0 }));
  f.fire('window', 'storage', { key: PREFIX + 'A', newValue: f.saved.get(PREFIX + 'A') }); assert.equal(f.banner(), undefined); assert.equal(f.timers.size, 0);
  f.saved.set(PREFIX + 'A', JSON.stringify({ enabled: true, nextAt: f.now() + 35 * MINUTE }));
  f.fire('window', 'storage', { key: PREFIX + 'A', newValue: f.saved.get(PREFIX + 'A') }); f.advance(35 * MINUTE - 1); assert.equal(f.banner(), undefined); f.advance(1); assert.ok(f.banner());
});

test('the scheduled callback rechecks another tab’s cooldown even without a storage event', () => {
  const f = fixture(); f.module.afterRender('library');
  f.saved.set(PREFIX + 'A', JSON.stringify({ enabled: true, nextAt: f.now() + 35 * MINUTE }));
  f.advance(20 * MINUTE); assert.equal(f.banner(), undefined); f.advance(15 * MINUTE); assert.ok(f.banner());
});

test('top nudges clear the fixed mobile header, and a focused reminder button is not removed by the timeout', () => {
  const f = fixture({ mobileBar: { getBoundingClientRect: () => ({ bottom: 58 }) } }); f.module.afterRender('settings');
  f.module.handleAction('hydration-preview'); assert.equal(f.banner().style.top, '70px');
  f.document.activeElement = { hydrationButton: true, closest: () => null }; f.advance(45000); assert.ok(f.banner());
  f.module.handleAction('hydration-dismiss'); assert.equal(f.banner(), undefined);
});

test('preview positions vary, never include the sidebar, and destroy removes timers and listeners', () => {
  const f = fixture(); f.module.afterRender('profile'); f.module.handleAction('hydration-preview'); const first = f.banner().className;
  f.module.handleAction('hydration-preview'); assert.notEqual(f.banner().className, first); assert.ok(parseInt(f.banner().style.left) >= 292);
  f.module.destroy(); assert.equal(f.banner(), undefined); assert.equal(f.timers.size, 0); assert.equal(Object.keys(f.docListeners).length, 0); assert.equal(Object.keys(f.winListeners).length, 0);
  f.module.afterRender('profile'); assert.ok(f.timers.size); assert.ok(Object.keys(f.docListeners).length);
});

test('settings and integration expose only browser-local preferences with no reward or completion controls', () => {
  const f = fixture(), controls = f.module.controls(); assert.match(controls, /len v tomto prehliadači/); assert.match(controls, /Nie je súčasťou hernej zálohy/);
  const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8'), html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.match(app, /MOHydration\.controls\(\)/); assert.match(app, /MOHydration\.afterRender\(view\)/); assert.match(app, /MOHydration\.destroy\(\)/); assert.match(app, /MOHydration\.handleAction/);
  assert.ok(html.indexOf('hydration.js') < html.indexOf('app.js?')); assert.match(html, /hydration\.css/);
});
