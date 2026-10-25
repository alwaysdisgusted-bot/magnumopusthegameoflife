const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/showcase.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; };
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

function fixture(handler) {
  let user = { id: 'A' }, renders = 0, activeRoot = null;
  const nodes = new Map(), opened = [], calls = [], toasts = [];
  const modal = { open: false, querySelector: () => activeRoot, close() { this.open = false; } };
  nodes.set('modal', modal);
  function node(html = '') {
    return { html, innerHTML: '', isConnected: true, inputs: [], listeners: {},
      addEventListener(type, callback) { this.listeners[type] = callback; }, removeAttribute() {},
      querySelectorAll() { return this.inputs; } };
  }
  const window = {
    MOQuoteCatalog: Array.from({ length: 8 }, (_, i) => ({ id: 'q' + (i + 1), text: i ? 'Myšlienka ' + (i + 1) : '<script>myšlienka</script>', author: 'Autor <&>' })),
    MOAuth: { getAccount: () => user, isAuthenticated: () => !!user,
      async api(route, options) {
        calls.push({ route, options, accountId: user?.id });
        if (handler) { const response = handler(route, options); if (response !== undefined) return response; }
        if (route === '/api/social/showcase') return { showcase: { quoteIds: options?.body.quoteIds || ['q1'], revision: options ? 4 : 3 } };
        if (route === '/api/quotes/saved') return { saved: Array.from({ length: 7 }, (_, i) => ({ quoteId: 'q' + (i + 1) })) };
        return { profile: { accountId: user.id, displayName: 'Čarodejník', visible: false }, quoteIds: ['q1'], featuredNotes: [], notes: [], nextOffset: null };
      } },
    MOApp: { esc: escape, render() { renders++; }, toast(message) { toasts.push(message); }, navigate() {},
      openModal(title, html, submit, options) {
        for (const [id, value] of nodes) if (id !== 'modal') value.isConnected = false;
        for (const id of [...nodes.keys()]) if (id !== 'modal') nodes.delete(id);
        for (const match of html.matchAll(/\bid="([^"]+)"/g)) nodes.set(match[1], node(html));
        activeRoot = nodes.get('showcase-loading') || nodes.get('showcase-editor') || (html.includes('data-showcase-modal') ? node(html) : null);
        if (nodes.has('showcase-editor')) nodes.get('showcase-editor').inputs = [...html.matchAll(/<input type="checkbox" name="quoteIds" value="([^"]+)"([^>]*)>/g)].map(match => ({ value: match[1], checked: match[2].includes('checked'), disabled: false }));
        opened.push({ title, html, submit, options }); modal.open = true;
      } }
  };
  const document = { getElementById: id => nodes.get(id) || null };
  vm.runInNewContext(source, { window, document, Map, Set, Date, Number, String, Error, Object, Promise });
  return { module: window.MOShowcase, window, nodes, opened, calls, modal, toasts, get renders() { return renders; }, setUser(id) { user = id ? { id } : null; } };
}

test('public showcase escapes notes and catalogue quotes, ignores unknown IDs and caps the public selection', () => {
  const f = fixture();
  const html = f.module.renderPublic({ profile: { accountId: 'B"<', visible: true }, quoteIds: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'unknown'], featuredNotes: [{ id: 'n"<', title: '<img onerror=1>', text: '<script>secret</script>', featured: true }], notes: [], nextOffset: 20 });
  assert.equal((html.match(/<figure/g) || []).length, 6);
  assert.match(html, /&lt;script&gt;myšlienka&lt;\/script&gt;/);
  assert.match(html, /&lt;img onerror=1&gt;/);
  assert.match(html, /data-id="n&quot;&lt;"/);
  assert.match(html, /Pripnutá na profile/);
  assert.match(html, /data-offset="20"/);
  assert.doesNotMatch(html, /<script>|q7|unknown/);
});

test('hidden profiles expose neither notes nor quote selections to a different account', () => {
  const f = fixture();
  const html = f.module.renderPublic({ profile: { accountId: 'B', visible: false }, quoteIds: ['q1'], featuredNotes: [{ id: 'n1', title: 'PRIVATE', text: 'PRIVATE' }] });
  assert.match(html, /nie je verejne dostupný/);
  assert.doesNotMatch(html, /PRIVATE|myšlienka/);
});

test('public profiles and quote pickers use transcribed text and never pass private books to source rendering',async()=>{
  const f=fixture(),sourceCalls=[];
  f.window.MOQuoteCatalog[0].image='assets/quotes/15.png';
  f.window.MOApp.state={books:[{id:'private-book',title:'PRIVATE_LIBRARY_TITLE'}]};
  f.window.MOQuoteSources={workMarkup(quote,options){sourceCalls.push(options);return '<p>Overený prameň</p>';}};
  const html=f.module.renderPublic({profile:{accountId:'B',visible:true},quoteIds:['q1']});
  assert.match(html,/&lt;script&gt;myšlienka/);assert.match(html,/Overený prameň/);assert.doesNotMatch(html,/<img|assets\/quotes|PRIVATE_LIBRARY_TITLE/);
  await f.module.handleAction('showcase-edit',{dataset:{}});
  assert.doesNotMatch(f.opened.at(-1).html,/<img|assets\/quotes|PRIVATE_LIBRARY_TITLE/);assert.ok(sourceCalls.every(options=>options===undefined));
});

test('public note cards offer editing only to their owner and the manager opens all public notes', async () => {
  const f = fixture(); let publicManagerOpened = 0;
  f.window.MODayNotes = { openPublic() { publicManagerOpened++; } };
  const data = owner => ({ profile: { accountId: owner, visible: true }, notes: [{ id: 'n1', title: 'Verejná poznámka', excerpt: 'Text' }] });
  assert.match(f.module.renderPublic(data('A')), /data-action="dn-edit" data-id="n1"/);
  assert.doesNotMatch(f.module.renderPublic(data('B')), /data-action="dn-edit"/);
  assert.match(f.module.renderOwn(), /data-action="showcase-manage-notes"/);
  await f.module.handleAction('showcase-manage-notes', { dataset: {} });
  assert.equal(publicManagerOpened, 1);
});

test('own profile loads only once and showing a preview never publishes saved quotes', async () => {
  const f = fixture(); f.module.renderOwn(); f.module.afterRender('profile'); await flush();
  f.module.afterRender('profile'); await flush();
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every(call => !call.options));
  const html = f.module.renderOwn();
  assert.match(html, /Profil je súkromný/);
  assert.match(html, /Uloženie citátu do zbierky ho samo nepridá/);
  assert.match(html, /&lt;script&gt;myšlienka/);
  f.setUser('B');
  assert.doesNotMatch(f.module.renderOwn(), /&lt;script&gt;myšlienka/);
});

test('quote picker uses saved quotes only, enforces six selections and saves explicitly with its revision', async () => {
  const f = fixture();
  await f.module.handleAction('showcase-edit', { dataset: {} });
  const editor = f.nodes.get('showcase-editor'), form = f.opened.at(-1);
  assert.equal(editor.inputs.length, 7);
  assert.doesNotMatch(form.html, /value="q8"/);
  assert.equal(f.calls.filter(call => call.options?.method === 'PUT').length, 0);
  editor.inputs.forEach((input, i) => { input.checked = i < 6; }); editor.listeners.change();
  assert.equal(editor.inputs[6].disabled, true);
  assert.match(f.nodes.get('showcase-selection-count').textContent, /6 \/ 6/);
  await assert.rejects(form.submit({ getAll: () => ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'] }), /najviac 6/);
  await form.submit({ getAll: () => ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'] });
  const write = f.calls.find(call => call.options?.method === 'PUT');
  assert.equal(write.route, '/api/social/showcase');
  assert.equal(write.options.body.expectedRevision, 3);
  assert.deepEqual(Array.from(write.options.body.quoteIds), ['q1', 'q2', 'q3', 'q4', 'q5', 'q6']);
});

test('a conflicting quote selection keeps the draft and requires an explicit current-selection reload', async () => {
  const f = fixture((route, options) => {
    if (options?.method === 'PUT') throw Object.assign(Error('conflict'), { status: 409 });
  });
  await f.module.handleAction('showcase-edit', { dataset: {} });
  const editor = f.nodes.get('showcase-editor'); editor.inputs[1].checked = true;
  await assert.rejects(f.opened.at(-1).submit({ getAll: () => ['q1', 'q2'] }), /inom okne/);
  assert.equal(editor.inputs[1].checked, true);
  assert.equal(editor.inputs[1].disabled, false);
  assert.match(f.nodes.get('showcase-selection-conflict').innerHTML, /Načítať aktuálny výber/);
  assert.equal(f.calls.filter(call => call.options?.method === 'PUT').length, 1);
});

test('account changes prevent a draft from being submitted under the next account and close the old editor', async () => {
  const f = fixture(); await f.module.handleAction('showcase-edit', { dataset: {} });
  const submit = f.opened.at(-1).submit; f.setUser('B');
  await assert.rejects(submit({ getAll: () => ['q1'] }), /Prihlásenie sa zmenilo/);
  assert.equal(f.calls.filter(call => call.options).length, 0);
  f.module.afterRender('hall'); assert.equal(f.modal.open, false);
});

test('public note reads recheck access each time and a delayed old-account response cannot open a note', async () => {
  const pending = deferred(); let reads = 0;
  const f = fixture(route => { if (route.includes('/notes/')) { reads++; return pending.promise; } });
  const opening = f.module.openPublicNote('B', 'n1');
  f.setUser('C'); f.module.afterRender('hall');
  pending.resolve({ note: { id: 'n1', title: 'PRIVATE OLD ACCOUNT', text: 'PRIVATE OLD ACCOUNT' } }); await opening;
  assert.equal(f.modal.open, false);
  assert.equal(reads, 1);
  assert.ok(f.opened.every(modal => !modal.html.includes('PRIVATE OLD ACCOUNT')));
  await f.module.openPublicNote('B', 'n1');
  assert.equal(reads, 2);
  assert.match(f.opened.at(-1).html, /PRIVATE OLD ACCOUNT/);
});

test('a note made private cannot be reopened from an earlier public card', async () => {
  let visible = true;
  const f = fixture(route => {
    if (!route.includes('/notes/')) return;
    if (!visible) throw Object.assign(Error('Poznámka už nie je verejne dostupná.'), { status: 404 });
    return { note: { id: 'n1', title: 'Poznámka', text: 'PREVIOUSLY PUBLIC TEXT' } };
  });
  await f.module.openPublicNote('B', 'n1'); assert.match(f.opened.at(-1).html, /PREVIOUSLY PUBLIC TEXT/);
  visible = false; await f.module.openPublicNote('B', 'n1');
  assert.doesNotMatch(f.opened.at(-1).html, /PREVIOUSLY PUBLIC TEXT/);
  assert.match(f.nodes.get('showcase-loading').innerHTML, /nie je verejne dostupná/);
  assert.equal(f.calls.filter(call => call.route.includes('/notes/')).length, 2);
});

test('pagination rechecks the profile endpoint and removes the old showcase when access is revoked', async () => {
  const f = fixture((route) => { if (route.includes('?offset=')) throw Object.assign(Error('Profil už nie je verejne dostupný.'), { status: 404 }); });
  const container = { isConnected: true, innerHTML: 'OLD PUBLIC CONTENT' };
  const el = { dataset: { account: 'B', offset: '20' }, disabled: false, isConnected: true, closest: () => container };
  await f.module.handleAction('showcase-more', el);
  assert.equal(f.calls[0].route, '/api/social/wizards/B?offset=20');
  assert.doesNotMatch(container.innerHTML, /OLD PUBLIC CONTENT/);
  assert.match(container.innerHTML, /nie je verejne dostupný/);
});
