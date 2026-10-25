'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const source = readFileSync(path.join(__dirname, '../public/desk-model.js'), 'utf8');
const common = { exports: {} };
Function('module', source)(common);
const M = common.exports;
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNSAAAAAASUVORK5CYII=';
const note = (id = 'note-1', extra = {}) => ({ id, type: 'note', x: 40, y: 30, width: 220, height: 180, z: 1, color: '#F7C9D5', text: 'Prvý nápad\nna ďalší deň.', ...extra });
const photo = (id = 'photo-1', extra = {}) => ({ id, type: 'image', x: 300, y: 400, width: 320, height: 240, z: 2, src: png, name: 'Záhrada.png', ...extra });
const stroke = (id = 'stroke-1', extra = {}) => ({ id, tool: 'pen', color: '#477456', size: 4, points: [{ x: 0, y: 0 }, { x: 1800, y: 1200 }], ...extra });

test('Additional canvases preserve the primary desk and validate independently without recursive collections', () => {
  const original = M.createState();
  original.items.push(note());
  original.canvases = [{ id: 'canvas-1', name: 'Nový kanvas', state: M.createState() }];
  const clean = M.validateState(original);
  assert.deepEqual(clean, original);
  clean.canvases[0].state.items.push(note('other'));
  assert.equal(original.canvases[0].state.items.length, 0);
  for (const patch of [
    { id: 'main' }, { name: '' }, { name: 'x'.repeat(81) },
    { state: { ...M.createState(), canvases: [] } },
    { state: { ...M.createState(), width: 5 } },
  ]) assert.throws(() => M.validateState({ ...original, canvases: [{ ...original.canvases[0], ...patch }] }));
  assert.throws(() => M.validateState({ ...original, canvases: [original.canvases[0], original.canvases[0]] }));
  assert.throws(() => M.validateState({ ...original, canvases: Array.from({ length: 21 }, (_, i) => ({ ...original.canvases[0], id: 'c' + i })) }));
});

test('Prázdne plátno a serverový model majú rovnakú východiskovú podobu', async () => {
  const original = M.createState();
  assert.deepEqual(original, { version: 1, width: 10000, height: 10000, background: '#000000', grid: { enabled: false, spacing: 24, style: 'dots', color: '#85744d', opacity: 0.15 }, strokes: [], items: [] });
  assert.deepEqual(M.validateState(original), original);
  const next = M.createState();
  original.items.push(note());
  assert.equal(next.items.length, 0);
  execFileSync(process.execPath, ['scripts/sync-desk-model.mjs', '--check'], { cwd: path.join(__dirname, '..') });
  const server = (await import('../server/desk-model.mjs')).default;
  assert.deepEqual(server.validateState(original), M.validateState(original));
});

test('Obnova zachová polohu, vrstvy, fotky, text a všetky kresliace nástroje bez zdieľania objektov', () => {
  const original = M.createState();
  original.items.push(note(), photo('photo-1', { x: 1480, y: 960 }));
  original.strokes = ['pen', 'eraser', 'line', 'rect', 'ellipse'].map((tool, index) => stroke('stroke-' + index, { tool, size: 1.25 }));
  const clean = M.validateState(original);
  assert.deepEqual(clean, original);
  clean.items[0].text = 'Zmenené';
  clean.items[1].x = 30;
  clean.strokes[0].points[0].x = 40;
  assert.notEqual(clean.items[0].text, original.items[0].text);
  assert.equal(original.items[1].x, 1480);
  assert.equal(original.strokes[0].points[0].x, 0);
});

test('Staré uloženia dostanú vypnutú mriežku a nové nastavenia sa zachovajú nezávisle', () => {
  const legacy = { ...M.createState(), width: 1800, height: 1200, background: '#f2e6c9' }; delete legacy.grid; legacy.items.push(note(), photo());
  const normalized = M.validateState(legacy);
  assert.deepEqual(normalized.grid, M.createState().grid); assert.equal(normalized.grid.enabled, false); assert.deepEqual(normalized.items, legacy.items);
  assert.equal(normalized.width, 1800); assert.equal(normalized.height, 1200); assert.equal(normalized.background, '#f2e6c9');
  assert.throws(() => M.validateState({ ...legacy, strokes: [stroke('outside', { points: [{ x: 1801, y: 0 }] })] }));
  const expanded = M.validateState({ ...legacy, width: 10000, height: 10000, strokes: [stroke('edge', { points: [{ x: 10000, y: 10000 }] })] });
  assert.equal(expanded.strokes[0].points[0].x, 10000); assert.deepEqual(expanded.items, legacy.items);
  const state = M.createState(); state.grid = { enabled: true, spacing: 40, style: 'lines', color: '#4058A6', opacity: 0.35 };
  const clean = M.validateState(state); assert.deepEqual(clean, state); clean.grid.spacing = 60; assert.equal(state.grid.spacing, 40);
  const next = M.createState(); next.grid.enabled = true; assert.equal(M.createState().grid.enabled, false);
});

test('Nastavenia mriežky sú ohraničené a nepovolia neznáme polia ani neplatné typy', () => {
  for (const patch of [{ enabled: 1 }, { enabled: 'false' }, { spacing: 9 }, { spacing: 101 }, { spacing: 20.5 }, { style: 'script' }, { color: '#fff' }, { color: 'url(x)' }, { opacity: 0.049 }, { opacity: 0.601 }, { opacity: NaN }, { opacity: Infinity }, { extra: true }]) {
    const state = M.createState(); Object.assign(state.grid, patch); assert.throws(() => M.validateState(state), JSON.stringify(patch));
  }
  for (const grid of [null, true, [], {}, { enabled: true, spacing: 24 }]) assert.throws(() => M.validateState({ ...M.createState(), grid }));
  for (const spacing of [10, 100]) for (const opacity of [0.05, 0.6]) for (const style of ['dots', 'lines']) assert.doesNotThrow(() => M.validateState({ ...M.createState(), grid: { enabled: true, spacing, style, color: '#123456', opacity } }));
});

test('Neplatné rozmery, súradnice, farby a typy sa neopravia potichu', () => {
  const invalid = [
    { ...M.createState(), version: 2 },
    { ...M.createState(), width: 1200 },
    { ...M.createState(), background: 'red' },
    { ...M.createState(), items: [note('n', { x: -1 })] },
    { ...M.createState(), items: [note('n', { y: Infinity })] },
    { ...M.createState(), items: [note('n', { width: 79 })] },
    { ...M.createState(), items: [note('n', { x: 9900 })] },
    { ...M.createState(), items: [note('n', { z: 1.5 })] },
    { ...M.createState(), items: [note('n', { color: 'url(javascript:x)' })] },
    { ...M.createState(), strokes: [stroke('s', { size: 61 })] },
    { ...M.createState(), strokes: [stroke('s', { tool: 'script' })] },
    { ...M.createState(), strokes: [stroke('s', { points: [] })] },
    { ...M.createState(), strokes: [stroke('s', { points: [{ x: NaN, y: 0 }] })] },
    { ...M.createState(), strokes: [stroke('s', { points: [{ x: 0, y: 10001 }] })] }
  ];
  invalid.forEach(value => assert.throws(() => M.validateState(value)));
});

test('ID položiek je bezpečné a jedinečné aj medzi fotkou a kresbou', () => {
  const state = M.createState();
  state.items = [note('duplicate')];
  state.strokes = [stroke('duplicate')];
  assert.throws(() => M.validateState(state), /jedinečné/);
  state.strokes = [];
  state.items = [note('bad id')];
  assert.throws(() => M.validateState(state), /identifikátor/);
  state.items = [note('a'.repeat(81))];
  assert.throws(() => M.validateState(state), /identifikátor/);
});

test('Fotky prijímajú iba vložené PNG, JPEG alebo WEBP; odmietnu SVG, URL a neplatné base64', () => {
  const state = M.createState();
  ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'javascript:alert(1)', 'https://example.com/a.png', 'data:image/png;base64,', 'data:image/png;base64,not valid!', 'data:image/png;base64,A', 'data:image/png;base64,AAAA===', 'data:image/gif;base64,AAAA'].forEach(src => {
    state.items = [photo('photo-1', { src })];
    assert.throws(() => M.validateState(state), /Fotka/);
  });
  ['png', 'jpeg', 'webp'].forEach(type => {
    state.items = [photo('photo-1', { src: 'data:image/' + type + ';base64,AAAA' })];
    assert.equal(M.validateState(state).items[0].src, state.items[0].src);
  });
  state.items = [photo('photo-1', { src: 'data:image/png;base64,' + 'A'.repeat(2800000) })];
  assert.throws(() => M.validateState(state), /Fotka/);
});

test('Limity lístkov, fotiek, dĺžky textu a kresieb zastavia priveľký dokument', () => {
  const state = M.createState();
  state.items = Array.from({ length: 100 }, (_, i) => note('n-' + i));
  assert.equal(M.validateState(state).items.length, 100);
  state.items.push(note('n-100'));
  assert.throws(() => M.validateState(state), /100 lístkov/);
  state.items = Array.from({ length: 21 }, (_, i) => photo('p-' + i));
  assert.throws(() => M.validateState(state), /20 fotiek/);
  state.items = [note('n', { text: 'x'.repeat(5001) })];
  assert.throws(() => M.validateState(state), /5000/);
  state.items = [photo('p', { name: 'x'.repeat(161) })];
  assert.throws(() => M.validateState(state), /160/);
  state.items = [];
  state.strokes = Array.from({ length: 2001 }, (_, i) => stroke('s-' + i));
  assert.throws(() => M.validateState(state), /ťahy/);
  const points = Array.from({ length: 50000 }, () => ({ x: 10, y: 20 }));
  state.strokes = [stroke('s-1', { points }), stroke('s-2', { points })];
  assert.equal(M.validateState(state).strokes[1].points.length, 50000);
  state.strokes.push(stroke('s-3', { points: [{ x: 1, y: 1 }] }));
  assert.throws(() => M.validateState(state), /100 000/);
});

test('Celkový limit meria UTF-8 bajty vrátane textov a fotiek', () => {
  const state = M.createState();
  const src = 'data:image/png;base64,' + 'A'.repeat(2300000);
  state.items = Array.from({ length: 4 }, (_, i) => photo('p-' + i, { src }));
  state.items.push(...Array.from({ length: 100 }, (_, i) => note('n-' + i, { text: '漢'.repeat(5000) })));
  assert.ok(JSON.stringify(state).length < 10 * 1024 * 1024);
  assert.throws(() => M.validateState(state), /10 MB/);
});

test('Validácia odmietne prototypy, prebytočné polia, prázdne polia a gettery bez ich vykonania', () => {
  const state = M.createState();
  assert.throws(() => M.validateState({ ...state, extra: true }), /Nepovolené/);
  assert.throws(() => M.validateState(Object.assign(Object.create({ inherited: true }), state)), /Neplatný objekt/);
  state.items = [note('n', { src: png })];
  assert.throws(() => M.validateState(state), /Nepovolené/);
  state.items = new Array(1);
  assert.throws(() => M.validateState(state), /zoznam|Zoznam/);
  let calls = 0;
  state.items = [];
  Object.defineProperty(state.items, '0', { get() { calls++; return note(); }, configurable: true });
  assert.throws(() => M.validateState(state));
  assert.equal(calls, 0);
  const object = M.createState();
  Object.defineProperty(object, 'background', { get() { calls++; return '#ffffff'; }, configurable: true });
  assert.throws(() => M.validateState(object));
  assert.equal(calls, 0);
});
