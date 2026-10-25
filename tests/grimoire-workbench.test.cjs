const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture() {
  const calls = [], view = { style: {} };
  let source;
  const create = () => ({
    children: [], style: {}, dataset: {}, ownerDocument: { defaultView: source, createElement: create },
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); },
    addEventListener(name, callback) { this[name] = callback; },
    querySelector() { return view; },
    attachShadow() { this.shadowRoot = create(); return this.shadowRoot; },
  });
  source = { location: { origin: 'http://127.0.0.1:4175' }, CustomEvent: class { constructor(type) { this.type = type; } }, dispatchEvent(event) { calls.push(['reset', event.type]); } };
  const window = {
    location: { origin: source.location.origin, href: source.location.origin + '/' },
    MOAuth: { isAuthenticated: () => true },
    MODesk: { embed(target) { calls.push(['desk', target]); }, endInteraction() { calls.push(['endInteraction']); }, setBrush(value) { calls.push(['brush', value]); }, category(value) { calls.push(['category', value]); } },
    MOAcademy: { embed(target) { calls.push(['workspace', target]); } },
    MOKnowledgeLibrary: { mode: () => 'grimoire' },
  };
  const document = { getElementById: () => ({ contentWindow: source }), createElement: create };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/grimoire-workbench.js'), 'utf8'), { window, document, URL, Set, Map });
  return { host: window.MOGrimoireWorkbench, calls, source, window, create, view };
}

test('workbench accepts only its registered same-origin authenticated Grimoire frame and exact surface', () => {
  const f = fixture();
  assert.throws(() => f.host.attach('desk', f.create(), {}), /dostupný/);
  assert.throws(() => f.host.attach('unknown', f.create(), f.source), /dostupný/);
  const foreign = f.create(); foreign.ownerDocument.defaultView = {};
  assert.throws(() => f.host.attach('desk', foreign, f.source), /dostupný/);
  f.window.MOAuth.isAuthenticated = () => false;
  assert.throws(() => f.host.attach('desk', f.create(), f.source), /dostupný/);
  assert.equal(f.calls.length, 0);
});

test('one shared engine transfers between Grimoire and original route without duplicating its state', () => {
  const f = fixture(), target = f.create();
  f.host.attach('desk', target, f.source); f.host.attach('desk', target, f.source);
  assert.equal(f.calls.filter(([kind, root]) => kind === 'desk' && root).length, 1);
  f.host.beforeRender('desk');
  assert.equal(f.calls.at(-1)[1], null);
  f.host.afterRender('library');
  const attached = f.calls.filter(([kind, root]) => kind === 'desk' && root);
  assert.equal(attached.length, 2); assert.equal(attached[0][1], attached[1][1]);
  f.host.detach('desk', {}); assert.equal(f.calls.length, 3);
  f.host.detach('desk', f.source); assert.equal(f.calls.at(-1)[1], null);
});

test('surface sizes are bounded, exact CSS pixels and retained on the shared root', () => {
  const f = fixture(); f.host.attach('desk', f.create(), f.source);
  for (const [width, height] of [[0, 600], [5800.5, 5800], [10001, 600], [600, 239]])
    assert.throws(() => f.host.resize('desk', width, height, f.source), /veľkosť/);
  assert.throws(() => f.host.resize('desk', 600, 450, {}), /veľkosť/);
  f.host.resize('desk', 5800, 5800, f.source);
  assert.deepEqual(f.view.style, { width: '5800px', height: '5800px' });
  assert.equal(f.calls[0][1].dataset.panelWidth, '5800');
  assert.equal(f.calls[0][1].dataset.panelHeight, '5800');
});

test('logout restores popups first and removes both account-owned embedded surfaces', () => {
  const f = fixture(), desk = f.create(), workspace = f.create();
  f.host.attach('desk', desk, f.source); f.host.attach('workspace', workspace, f.source); f.host.destroy();
  assert.equal(f.calls[2][0], 'reset');
  assert.equal(f.calls.filter(([kind, root]) => ['desk', 'workspace'].includes(kind) && root === null).length, 2);
  assert.equal(desk.children.length, 0); assert.equal(workspace.children.length, 0);
  f.host.afterRender('library');
  assert.equal(f.calls.length, 5);
});

test('shared text background uses the existing desk surface and retains floating controls', () => {
  const f = fixture();
  f.host.attach('desk', f.create(), f.source);
  const root = f.calls[0][1];
  assert.equal(root.dataset.sharedSurface, 'true');
  const source = fs.readFileSync(path.join(__dirname, '../public/desk.js'), 'utf8');
  assert.match(source, /el\.dataset\.sharedSurface==='true'/);
  assert.match(source, /controls\.append\(child\)/);
  assert.match(source, /desk-heading,\.desk-notice,\.desk-toolbar,\.desk-selection-bar,\.desk-footer/);
});

test('ending a shared drawing interaction requires the registered authenticated frame', () => {
  const f = fixture();
  assert.throws(() => f.host.endInteraction(f.source), /dostupný/);
  f.host.attach('desk', f.create(), f.source);
  assert.throws(() => f.host.endInteraction({}), /dostupný/);
  f.window.MOAuth.isAuthenticated = () => false;
  assert.throws(() => f.host.endInteraction(f.source), /dostupný/);
  f.window.MOAuth.isAuthenticated = () => true;
  f.host.endInteraction(f.source);
  assert.equal(f.calls.at(-1)[0], 'endInteraction');
  f.host.detach('desk', f.source);
  assert.throws(() => f.host.endInteraction(f.source), /dostupný/);
});

test('shared brush and categories require the claimed authenticated frame', () => {
  const f = fixture();
  assert.throws(() => f.host.tools({ color: '#123456' }, 'colors', f.source), /dostupný/);
  f.host.attach('desk', f.create(), f.source);
  assert.throws(() => f.host.tools({}, 'drawing', {}), /dostupný/);
  f.host.tools({ color: '#123456', size: 8 }, 'colors', f.source);
  assert.equal(f.calls.at(-2)[0], 'brush');
  assert.equal(f.calls.at(-1)[1], 'colors');
  f.host.beforeRender('desk');
  assert.throws(() => f.host.tools({}, 'text', f.source), /dostupný/);
});

test('external desk controls reject foreign windows and workspace targets before attaching', () => {
  const f = fixture(), host = f.create(), controls = f.create();
  controls.ownerDocument.defaultView = {};
  assert.throws(() => f.host.attach('desk', host, f.source, controls), /dostupný/);
  assert.throws(() => f.host.attach('desk', host, f.source, host), /dostupný/);
  controls.ownerDocument.defaultView = f.source;
  assert.throws(() => f.host.attach('workspace', host, f.source, controls), /dostupný/);
  assert.equal(f.calls.length, 0);
});

test('continuous Grimoire navigation focuses existing sections without hiding or replacing drafts', () => {
  const source = fs.readFileSync(path.join(__dirname, '../knowledge-app/src/ui/search-screen.ts'), 'utf8');
  const start = source.indexOf("  function setGrimoireView(view: 'reading' | 'workbench'): void {");
  const end = source.indexOf("\n  root.querySelectorAll<HTMLButtonElement>", start);
  assert.ok(start > 0 && end > start);
  const calls = [];
  const section = name => ({
    hidden: false, draft: { value: name + '-draft' },
    focus(options) { calls.push([name, 'focus', options.preventScroll]); },
    scrollIntoView(options) { calls.push([name, 'scroll', options.block]); },
  });
  const readingArea = section('reading'), element = section('workbench');
  const buttons = ['reading', 'workbench'].map(view => ({
    dataset: { grimoireView: view }, classList: { toggle() {} },
    setAttribute(name, value) { this[name] = value; },
  }));
  const root = { dataset: {}, querySelectorAll: () => buttons, dispatchEvent() {} };
  const drafts = [readingArea.draft, element.draft];
  const js = source.slice(start, end)
    .replace("view: 'reading' | 'workbench'", 'view')
    .replace('): void {', ') {')
    .replace('querySelectorAll<HTMLButtonElement>', 'querySelectorAll');
  const context = { root, Event: class {}, readingArea, workbench: { element, activate() {} }, resetScrollReadingTracking() {} };
  vm.runInNewContext(js + '\nsetGrimoireView("workbench"); setGrimoireView("reading");', context);
  assert.equal(readingArea.hidden, false);
  assert.equal(element.hidden, false);
  assert.equal(readingArea.draft, drafts[0]);
  assert.equal(element.draft, drafts[1]);
  assert.deepEqual(calls, [['workbench', 'focus', true], ['workbench', 'scroll', 'start'], ['reading', 'focus', true], ['reading', 'scroll', 'start']]);
  assert.equal(root.dataset.grimoireView, 'reading');
  assert.equal(buttons[0]['aria-pressed'], 'true');
  assert.equal(buttons[1]['aria-pressed'], 'false');
});

test('hiding a retained Grimoire frame does not restore a stale reader scroll position', () => {
  const source = fs.readFileSync(path.join(__dirname, '../knowledge-app/src/ui/search-screen.ts'), 'utf8');
  const start = source.indexOf('  let readerWidth = 0');
  const end = source.indexOf('  readerResize.observe(readerText)', start);
  assert.ok(start > 0 && end > start);
  const text = { isConnected: true, clientWidth: 700, clientHeight: 600, scrollTop: 0 };
  let resize, restores = 0;
  vm.runInNewContext(source.slice(start, end), {
    ResizeObserver: class { constructor(callback) { resize = callback; } },
    readerText: text, readingDocumentId: 'doc', readingVersion: 'original',
    positions: new Map([['doc', {}]]), editedPositions: new Map(),
    applyReadingLayout() { restores++; text.scrollTop = 0; },
  });
  resize();
  text.scrollTop = 300;
  text.clientWidth = 0; text.clientHeight = 0; resize();
  text.clientWidth = 700; text.clientHeight = 600; resize();
  assert.equal(restores, 1);
  assert.equal(text.scrollTop, 300);
  text.clientWidth = 500; resize();
  assert.equal(restores, 2);
});

function screenPagerFixture() {
  const nodes = [];
  const create = () => {
    const node = {
      childNodes: [], parent: null, handlers: {}, classes: new Set(), dataset: {},
      get parentNode() { return this.parent; },
      nextSibling: null,
      insertBefore(child) { this.append(child); },
      click() { this.handlers.click?.(); },
      clientHeight: 800, scrollHeight: 2050, scrollTop: 0, textContent: '',
      classList: { add(name) { node.classes.add(name); }, remove(name) { node.classes.delete(name); } },
      get children() { return this.childNodes; },
      append(...children) {
        for (const child of children) {
          child.remove(); this.childNodes.push(child); child.parent = this;
        }
      },
      remove() {
        if (this.parent) this.parent.childNodes.splice(this.parent.childNodes.indexOf(this), 1);
        this.parent = null;
      },
      setAttribute() {},
      addEventListener(name, callback) { this.handlers[name] = callback; },
      removeEventListener(name) { delete this.handlers[name]; },
      querySelector(selector) {
        this.queries ??= {};
        return this.queries[selector] ??= create();
      },
    };
    nodes.push(node);
    return node;
  };
  const root = create(), shell = create(), draft = { text: 'unsaved', strokes: [1, 2] };
  const workbench = create();
  shell.draft = draft; shell.append(workbench); root.append(shell);
  root.queries = { '#grimoire-workbench': workbench };
  for (const view of ['reading', 'workbench']) {
    const button = create();
    button.handlers.click = () => { root.dataset.grimoireView = view; root.handlers['grimoire-view-change'](); };
    root.queries[`button[data-grimoire-view="${view}"]`] = button;
  }
  const source = fs.readFileSync(path.join(__dirname, '../knowledge-app/src/ui/screen-pager.ts'), 'utf8');
  const js = require('typescript').transpileModule(source, { compilerOptions: { module: 1, target: 9 } }).outputText;
  const exports = {};
  const document = { createElement: create, documentElement: create() };
  vm.runInNewContext(js, {
    exports, document,
  });
  const destroy = exports.mountScreenPager(root);
  const [controls, viewport] = root.children;
  return { root, shell, draft, workbench, viewport, controls, document, destroy };
}

test('two Grimoire surfaces switch synchronously and always retain exactly two pages', () => {
  const f = screenPagerFixture();
  const previous = f.controls.querySelector('[data-screen-previous]');
  const next = f.controls.querySelector('[data-screen-next]');
  const status = f.controls.querySelector('[role="status"]');
  assert.equal(previous.disabled, true);
  assert.equal(status.textContent, '1 / 2');
  assert.equal(f.viewport.children.length, 2);
  const [reading, editing] = f.viewport.children;
  assert.equal(reading.hidden, false);
  assert.equal(editing.hidden, true);
  next.handlers.click();
  assert.equal(reading.hidden, true);
  assert.equal(editing.hidden, false);
  assert.equal(next.disabled, true);
  assert.equal(status.textContent, '2 / 2');
  previous.handlers.click();
  assert.equal(reading.hidden, false);
  assert.equal(editing.hidden, true);
  assert.equal(status.textContent, '1 / 2');
});

test('two-page switching keeps live drafts and restores the original DOM and listeners on cleanup', () => {
  const f = screenPagerFixture();
  assert.equal(f.viewport.children[0].children[0], f.shell);
  assert.equal(f.viewport.children[1].children[0], f.workbench);
  assert.equal(f.shell.draft, f.draft);
  assert.equal(f.viewport.handlers.wheel, undefined);
  assert.equal(f.viewport.handlers.keydown, undefined);
  f.controls.querySelector('[data-screen-next]').handlers.click();
  assert.equal(f.shell.draft, f.draft);
  f.destroy();
  assert.equal(f.root.handlers['grimoire-view-change'], undefined);
  assert.equal(f.root.children.length, 1);
  assert.equal(f.root.children[0], f.shell);
  assert.equal(f.shell.children[0], f.workbench);
  assert.equal(f.root.classes.size, 0);
  assert.equal(f.document.documentElement.classes.size, 0);
});

test('Grimoire defaults to its original text editor and clearing a document does not replace it with the planner', () => {
  const source = fs.readFileSync(path.join(__dirname, '../knowledge-app/src/editor/workbench.ts'), 'utf8');
  const js = require('typescript').transpileModule(source, { compilerOptions: { module: 1, target: 9 } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports });
  const slots = { '[data-workspace-slot]': {}, '[data-document-slot]': {}, '[data-no-document]': {} };
  const buttons = ['document', 'workspace'].map(value => ({
    dataset: { source: value }, setAttribute(name, value) { this[name] = value; },
  }));
  const template = source.slice(source.indexOf('this.element.innerHTML'), source.indexOf('this.status ='));
  assert.match(template, /<h3>Textový editor<\/h3>/);
  assert.match(template, /data-source="document" aria-pressed="true"/);
  assert.match(template, /data-workspace-slot hidden/);
  assert.doesNotMatch(template, /data-document-slot hidden/);
  const draft = { text: 'unsaved rich editor', strokes: [1] };
  slots['[data-document-slot]'].draft = draft;
  const pane = { querySelector: selector => slots[selector], querySelectorAll: () => buttons };
  const drawing = { textContent: '' };
  const workbench = Object.create(exports.Workbench.prototype);
  workbench.panels = new Map([['text', { pane }], ['canvas', { pane: { querySelector: () => drawing } }]]);
  workbench.restoreAll = () => {};
  workbench.selectSource('workspace');
  assert.equal(slots['[data-document-slot]'].hidden, true);
  workbench.clearDocument();
  assert.equal(slots['[data-workspace-slot]'].hidden, true);
  assert.equal(slots['[data-document-slot]'].hidden, false);
  assert.equal(buttons[0]['aria-pressed'], 'true');
  assert.equal(slots['[data-document-slot]'].draft, draft);
});

test('Alchemist desk is a top-level menu destination without a Gallery parent or room shortcut', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const nav = source.match(/const nav=(\[[^\n]+\]);/)[1];
  const entries = vm.runInNewContext(nav);
  const desk = entries.find(([id]) => id === 'desk');
  assert.equal(desk.length, 3);
  assert.equal(desk[1], 'Alchymistický stôl');
  assert.doesNotMatch(source, /view==='desk'\?'gallery'/);
  assert.doesNotMatch(source, /DIELŇA V GALÉRII/);
});
