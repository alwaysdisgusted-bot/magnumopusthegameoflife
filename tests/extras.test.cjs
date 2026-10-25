'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../server/game-model.cjs');
let state = M.createState();
let modal;
let navigated;
const app = {
  get state() { return state; },
  model: M,
  esc: value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
  icon: name => '<svg data-icon="' + name + '"></svg>',
  commit(mutator) { const next = structuredClone(state); const result = mutator(next); state = M.validateState(next); return { ok: true, result }; },
  openModal(title, html, submit) { modal = { title, html, submit }; },
  uid: () => 'strategy-test',
  navigate: view => { navigated = view; },
  toast() {}, render() {}
};
global.window = { MOApp: app };
require('node:vm').runInThisContext(require('node:fs').readFileSync(require('node:path').join(__dirname,'../public/extras.js'),'utf8')); 
const extras = window.MOExtras;
const action = (name, id) => extras.handleAction(name, { dataset: { id } });
const submit = values => modal.submit(new Map(Object.entries(values)));

test('Additional rooms render usable empty states and escape personal text', () => {
  for (const view of ['meditation', 'gallery', 'farm', 'shop', 'challenges', 'bank', 'calendar', 'profile']) {
    assert.match(extras.render(view), /<section class="(?:page |scene illustrated-room )/, view);
  }
  state.profile.name = '<img src=x onerror=alert(1)>';
  assert.ok(extras.render('profile').includes('&lt;img src=x onerror=alert(1)&gt;'));
  state.profile.name = 'Čarodej';
  assert.equal(extras.render('unknown'), '');
  assert.equal(action('unknown'), false);
});

test('Meditation, daily claim, shop, wardrobe and farm share the validated ledger', () => {
  action('extra-meditate');
  assert.throws(() => submit({ minutes: '-5' }));
  assert.equal(state.meditation.total, 0);
  submit({ minutes: '300' });
  assert.equal(M.balance(state), 12);
  action('extra-claim-daily', 'meditation-25');
  assert.equal(M.powder(state), 1);
  assert.throws(() => action('extra-claim-daily', 'meditation-25'));
  action('extra-buy', 'rose'); submit({});
  action('extra-equip', 'rose');
  assert.equal(state.profile.equipped, 'rose');
  assert.equal(M.balance(state), 0);
  app.commit(s => M.meditate(s, 200));
  action('extra-buy', 'cat'); submit({});
  assert.deepEqual(state.animals, ['cat']);
  assert.match(extras.render('farm'), /Mačka Luna/);
});

test('Projects can be renamed and can pay a completion reward once', () => {
  action('extra-project-add'); submit({ title: 'Moja kresba' });
  const id = state.projects[0].id;
  action('extra-project-edit', id); submit({ title: 'Hotová kresba' });
  assert.equal(state.projects[0].title, 'Hotová kresba');
  action('extra-project-finish', id); submit({});
  assert.equal(M.balance(state), 1);
  action('extra-project-finish', id);
  assert.throws(() => submit({}));
  assert.equal(M.balance(state), 1);
});

test('Bank rejects invalid amounts, saves decimal balances, and manages strategies', () => {
  action('extra-bank-edit');
  assert.throws(() => submit({ card: 'NaN', cash: '0', invested: '0', owed: '0', receivable: '0' }));
  submit({ card: '1000.25', cash: '25.50', invested: '500', owed: '80', receivable: '30' });
  assert.equal(state.bank.card, 1000.25);
  assert.match(extras.render('bank'), /1\s*475,75/);
  action('extra-strategy-add'); submit({ title: 'Rezerva', target: '3000', monthly: '100', deadline: '2027-12-31', notes: 'Pravidelne odkladať.' });
  assert.equal(state.strategies[0].monthly, 100);
  action('extra-strategy-edit', 'strategy-test'); submit({ title: 'Moja rezerva', target: '3000', monthly: '150', deadline: '', notes: '' });
  assert.equal(state.strategies[0].title, 'Moja rezerva');
  assert.equal(state.strategies[0].monthly, 150);
  action('extra-strategy-delete', 'strategy-test'); submit({});
  assert.equal(state.strategies.length, 0);
});

test('Calendar links require HTTPS and personal name edits persist', () => {
  action('extra-calendar-edit');
  assert.throws(() => submit({ url: 'javascript:alert(1)' }));
  assert.equal(state.settings.calendarUrl, '');
  submit({ url: 'https://example.com/my-calendar' });
  assert.match(extras.render('calendar'), /rel="noopener noreferrer"/);
  assert.match(extras.render('calendar'), /href="https:\/\/example.com\/my-calendar"/);
  action('extra-profile-edit'); submit({ name: 'Peter' });
  assert.equal(state.profile.name, 'Peter');
  action('extra-open-shop'); assert.equal(navigated, 'shop');
});
