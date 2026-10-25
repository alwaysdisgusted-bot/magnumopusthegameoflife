const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../public/auth.js'), 'utf8');
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function fixture(handler, initialStorage = {}, desk = null) {
  const storage = new Map(Object.entries(initialStorage));
  const requests = [];
  const activations = [];
  const deactivations = [];
  const listeners = {};
  const timers = new Map();
  let timerId = 0;
  let current = { value: 0 };
  const element = () => ({ addEventListener() {}, classList: { add() {}, remove() {} }, textContent: '', disabled: false });
  const authRoot = { hidden: false, innerHTML: '', querySelector: element, querySelectorAll: () => [] };
  const document = {
    getElementById: id => id === 'auth-screen' ? authRoot : null,
    querySelector: () => null,
    body: { classList: { add() {}, remove() {} }, appendChild() {} }
  };
  const window = {
    MODesk: desk,
    location: { pathname: '/', search: '', hash: '' },
    addEventListener: (name, callback) => { listeners[name] = callback; },
    MOModel: { validateState: value => { assert.equal(typeof value.value, 'number'); return value; } },
    confirm: () => true
  };
  const context = vm.createContext({
    window, document, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    fetch: async (url, options) => { const request = { url, ...options, body: options.body ? JSON.parse(options.body) : undefined }; requests.push(request); return handler(request); },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id), URL, Blob, console
  });
  vm.runInContext(source, context);
  const hooks = {
    getLegacyState: () => null,
    getState: () => current,
    applyServerState: state => { current = state; storage.set('magnum-opus:account:wizard-1', JSON.stringify(state)); },
    activate: payload => { current = payload.state; activations.push(payload); },
    deactivate: options => { current = null; deactivations.push(options); },
    exportBackup() {}
  };
  return { auth: window.MOAuth, window, hooks, storage, requests, activations, deactivations, listeners, timers,
    setCurrent: state => { current = state; } };
}

const session = revision => response({ account: { id: 'wizard-1', name: 'Merlin' }, csrf: 'memory-only-csrf', save: { state: { value: 0 }, revision, updatedAt: '2026-10-18T18:00:00Z' } });
const metadata = f => JSON.parse(f.storage.get('magnum-opus:account:wizard-1:sync'));

test('reading credit uses the server endpoint and merges one coin without replacing concurrent drafts', async () => {
  const wait=deferred(),baseline={value:0,ledger:[]},reward={id:'page-reward',type:'grimoire-reading',coins:1};
  const f=fixture(request=>{
    if(request.url.endsWith('/session'))return response({account:{id:'wizard-1'},csrf:'csrf',save:{state:baseline,revision:1}});
    if(request.url.endsWith('/reading'))return wait.promise;
    return response({revision:3});
  });
  await f.auth.init(f.hooks);
  const operation=f.auth.recordReadingTurn({eventId:'event',documentId:'doc',fromPage:1,toPage:2});
  await new Promise(resolve=>setImmediate(resolve));
  f.setCurrent({value:42,ledger:[]});f.auth.queueSave(f.hooks.getState());
  wait.resolve(response({turns:25,towardsReward:0,awarded:true,save:{state:{...baseline,ledger:[reward]},revision:2}}));
  await operation;
  assert.equal(f.hooks.getState().value,42);
  assert.equal(f.hooks.getState().ledger[0].coins,1);
  assert.equal(f.requests.find(r=>r.url.endsWith('/reading')).body.expectedGameRevision,1);
  assert.equal(metadata(f).revision,2);
});

test('reading lost-response recovery retains the canonical one-coin receipt and permits idempotent retry', async () => {
  const baseline={value:0,ledger:[]},reward={id:'page-reward',type:'grimoire-reading',coins:1};
  let requests=0;
  const saved={state:{...baseline,ledger:[reward]},revision:2};
  const f=fixture(request=>{
    if(request.url.endsWith('/session'))return response({account:{id:'wizard-1'},csrf:'csrf',save:{state:baseline,revision:1}});
    if(request.url.endsWith('/reading')){
      if(requests++===0)throw Error('lost committed response');
      return response({turns:25,towardsReward:0,awarded:false,save:saved});
    }
    return response(saved);
  });
  await f.auth.init(f.hooks);
  await assert.rejects(f.auth.recordReadingTurn({eventId:'same-event'}),e=>e.code==='NETWORK_ERROR');
  await f.auth.recordReadingTurn({eventId:'same-event'});
  assert.equal(f.hooks.getState().ledger.length,1);
  assert.equal(metadata(f).revision,2);
});

test('term reward merges only authoritative entries while preserving a concurrent game draft and ledger order', async () => {
  const wait = deferred();
  const oldReward={id:'old',type:'knowledge-term',coins:10};
  const spent={id:'spent',type:'purchase',coins:-5};
  const reward={id:'new',type:'knowledge-term',coins:10};
  const baseline={value:0,ledger:[oldReward,spent]};
  const f=fixture(request=>{
    if(request.url.endsWith('/session')) return response({account:{id:'wizard-1'},csrf:'csrf',save:{state:baseline,revision:1}});
    if(request.url.endsWith('/terminology')) return wait.promise;
    return response({revision:3});
  });
  await f.auth.init(f.hooks);
  const operation=f.auth.mutateTerminology({operation:'save'});
  await new Promise(resolve=>setImmediate(resolve));
  f.setCurrent({value:7,ledger:[oldReward,spent]});
  f.auth.queueSave(f.hooks.getState());
  await assert.rejects(f.auth.saveNow(),error=>error.code==='TERM_BUSY');
  await assert.rejects(f.auth.logout(),error=>error.code==='TERM_BUSY');
  wait.resolve(response({awarded:true,save:{state:{...baseline,ledger:[oldReward,spent,reward]},revision:2,updatedAt:1}}));
  await operation;
  assert.equal(f.hooks.getState().value,7);
  assert.deepEqual(Array.from(f.hooks.getState().ledger,item=>item.id),['old','spent','new']);
  assert.equal(metadata(f).revision,2);
  assert.equal(metadata(f).pending,true);
  await f.auth.saveNow();
  const write=f.requests.find(request=>request.method==='PUT');
  assert.equal(write.body.expectedRevision,2);
  assert.equal(write.body.state.value,7);
  assert.equal(write.body.state.ledger.filter(item=>item.id==='new').length,1);
});

test('term reward recovers a committed credit after a lost response without hiding the network failure', async () => {
  const baseline={value:0,ledger:[]}, reward={id:'reward',type:'knowledge-term',coins:10};
  const f=fixture(request=>{
    if(request.url.endsWith('/session')) return response({account:{id:'wizard-1'},csrf:'csrf',save:{state:baseline,revision:1}});
    if(request.url.endsWith('/terminology')) throw new Error('lost response after commit');
    if(request.url==='/api/save') return response({state:{...baseline,ledger:[reward]},revision:2});
    throw new Error('unexpected');
  });
  await f.auth.init(f.hooks);
  await assert.rejects(f.auth.mutateTerminology({operation:'save'}),error=>error.code==='NETWORK_ERROR');
  assert.equal(f.hooks.getState().ledger.length,1);
  assert.equal(metadata(f).revision,2);
  assert.equal(metadata(f).pending,false);
});

test('term credit reconciliation refuses unrelated server changes and retains the local game draft', async () => {
  const baseline={value:0,ledger:[]};
  const f=fixture(request=>{
    if(request.url.endsWith('/session')) return response({account:{id:'wizard-1'},csrf:'csrf',save:{state:baseline,revision:1}});
    if(request.url.endsWith('/terminology')) return response({save:{state:{value:99,ledger:[]},revision:2}});
    return response({state:{value:99,ledger:[]},revision:2});
  });
  await f.auth.init(f.hooks);
  await assert.rejects(f.auth.mutateTerminology({operation:'save'}),error=>error.code==='TERM_SAVE_CONFLICT');
  assert.equal(f.hooks.getState().value,0);
  assert.equal(metadata(f).pending,true);
  await assert.rejects(f.auth.saveNow(),error=>error.code==='TERM_SAVE_CONFLICT');
});

test('term session expiry retains the suspended draft rather than replacing it with deactivated UI state', async () => {
  const wait=deferred(), baseline={value:0,ledger:[]};
  const f=fixture(request=>{
    if(request.url.endsWith('/session'))return response({account:{id:'wizard-1'},csrf:'csrf',save:{state:baseline,revision:1}});
    return wait.promise;
  });
  await f.auth.init(f.hooks);
  const mutation=f.auth.mutateTerminology({operation:'save'});
  await new Promise(resolve=>setImmediate(resolve));
  f.setCurrent({value:42,ledger:[]}); f.auth.queueSave(f.hooks.getState());
  wait.resolve(response({error:{message:'Expired'}},401));
  await assert.rejects(mutation,error=>error.status===401);
  assert.equal(f.auth.isAuthenticated(),false);
  assert.equal(f.deactivations[0].preserveDraft,true);
  await f.auth.init(f.hooks);
  assert.equal(f.hooks.getState().value,42);
  assert.equal(metadata(f).pending,true);
});

test('personal local opens one profile automatically and can close and reopen without an external login', async () => {
  let active = false;
  const f = fixture(request => {
    if (request.url === '/api/auth/session') return active ? response({ account: { id: 'wizard-1', name: 'AlwaysDisgusted' }, csrf: 'local-csrf', save: { state: { value: 7 }, revision: 1 }, localMode: true }) : response({ account: null, localMode: true, requiresSiteLogin: false });
    if (request.url === '/api/auth/local') { active = true; return response({ account: { id: 'wizard-1', name: 'AlwaysDisgusted' }, csrf: 'local-csrf', save: { state: { value: 7 }, revision: 1 }, localMode: true }); }
    if (request.url === '/api/auth/logout') { active = false; return response({ ok: true }); }
    throw new Error('Unexpected request: ' + request.url);
  });
  assert.equal((await f.auth.init(f.hooks)).authenticated, true);
  assert.equal(f.auth.isLocal(), true);
  assert.equal(f.activations[0].state.value, 7);
  assert.equal(f.requests[1].method, 'POST');
  assert.equal(f.requests[1].headers['X-MO-Request'], '1');
  assert.equal(await f.auth.logout(), true);
  assert.equal(f.auth.isAuthenticated(), false);
  assert.equal((await f.auth.init(f.hooks)).authenticated, true);
  assert.equal(f.auth.getAccount().id, 'wizard-1');
  assert(f.requests.every(request => request.url.startsWith('/api/')));
});

test('serializes saves and sends only the latest queued draft with the new revision', async () => {
  const first = deferred();
  let puts = 0;
  const f = fixture(request => request.url.endsWith('/session') ? session(3) : ++puts === 1 ? first.promise : response({ revision: 5, updatedAt: '2026-10-18T18:02:00Z' }));
  await f.auth.init(f.hooks);
  f.auth.queueSave({ value: 1 });
  const saving = f.auth.saveNow();
  f.auth.queueSave({ value: 2 });
  f.auth.queueSave({ value: 3 });
  first.resolve(response({ revision: 4, updatedAt: '2026-10-18T18:01:00Z' }));
  await saving;
  const writes = f.requests.filter(r => r.method === 'PUT');
  assert.deepEqual(writes.map(r => [r.body.state.value, r.body.expectedRevision]), [[1, 3], [3, 4]]);
  assert.equal(writes[0].headers['X-MO-CSRF'], 'memory-only-csrf');
  assert.equal(writes[0].headers['X-MO-Request'], '1');
  assert.equal(writes[0].credentials, 'same-origin');
  assert.equal(metadata(f).pending, false);
  assert.equal(metadata(f).revision, 5);
  assert.equal([...f.storage.values()].some(v => v.includes('memory-only-csrf')), false);
});

test('network failures retain the draft and retry with the unchanged revision', async () => {
  let attempts = 0;
  const f = fixture(request => {
    if (request.url.endsWith('/session')) return session(7);
    if (++attempts === 1) throw new Error('offline');
    return response({ revision: 8, updatedAt: null });
  });
  await f.auth.init(f.hooks);
  f.auth.queueSave({ value: 22 });
  await assert.rejects(f.auth.saveNow(), e => e.code === 'NETWORK_ERROR');
  assert.equal(metadata(f).pending, true);
  await f.auth.saveNow();
  assert.deepEqual(f.requests.filter(r => r.method === 'PUT').map(r => r.body.expectedRevision), [7, 7]);
  assert.equal(metadata(f).pending, false);
});

test('a revision conflict blocks subsequent writes without discarding the latest draft', async () => {
  const f = fixture(request => request.url.endsWith('/session') ? session(2) : response({ code: 'SAVE_CONFLICT', message: 'Another save exists' }, 409));
  await f.auth.init(f.hooks);
  f.auth.queueSave({ value: 1 });
  await assert.rejects(f.auth.saveNow(), e => e.status === 409);
  f.auth.queueSave({ value: 2 });
  await assert.rejects(f.auth.saveNow(), e => e.status === 409);
  assert.equal(f.requests.filter(r => r.method === 'PUT').length, 1);
  assert.equal(metadata(f).pending, true);
  assert.equal(f.timers.size, 0);
});

test('recovers an offline local draft when its base revision matches the cloud', async () => {
  const f = fixture(request => request.url.endsWith('/session') ? session(4) : response({ revision: 5 }), {
    'magnum-opus:account:wizard-1': JSON.stringify({ value: 84 }),
    'magnum-opus:account:wizard-1:sync': JSON.stringify({ pending: true, revision: 4, updatedAt: null })
  });
  await f.auth.init(f.hooks);
  assert.equal(f.activations[0].state.value, 84);
  assert.equal(f.activations[0].revision, 4);
  assert.equal(metadata(f).pending, true);
  await f.auth.saveNow();
  assert.equal(f.requests.find(r => r.method === 'PUT').body.state.value, 84);
});

test('restores a pending local draft but blocks overwrite when cloud revision differs', async () => {
  const f = fixture(() => session(6), {
    'magnum-opus:account:wizard-1': JSON.stringify({ value: 84 }),
    'magnum-opus:account:wizard-1:sync': JSON.stringify({ pending: true, revision: 4, updatedAt: null })
  });
  await f.auth.init(f.hooks);
  assert.equal(f.activations[0].state.value, 84);
  await assert.rejects(f.auth.saveNow(), e => e.status === 409);
  assert.equal(f.requests.length, 1);
  assert.equal(metadata(f).revision, 4);
});

test('logout cannot discard a draft after a failed flush', async () => {
  const f = fixture(request => request.url.endsWith('/session') ? session(1) : response({ message: 'Unavailable' }, 503));
  await f.auth.init(f.hooks);
  f.auth.queueSave({ value: 9 });
  assert.equal(await f.auth.logout(), false);
  assert.equal(f.auth.isAuthenticated(), true);
  assert.equal(f.deactivations.length, 0);
  assert.equal(f.requests.some(r => r.url.endsWith('/logout')), false);
  assert.equal(metadata(f).pending, true);
});

test('an expired session clears personal UI while preserving the local draft', async () => {
  const f = fixture(request => request.url.endsWith('/session') ? session(1) : response({ message: 'Expired' }, 401));
  await f.auth.init(f.hooks);
  f.auth.queueSave({ value: 9 });
  await assert.rejects(f.auth.saveNow(), e => e.status === 401);
  assert.equal(f.auth.isAuthenticated(), false);
  assert.equal(f.deactivations[0].preserveDraft, true);
  assert.equal(metadata(f).pending, true);
});

test('logout retains the account when its alchemy desk cannot be saved', async () => {
  const f = fixture(request => request.url.endsWith('/session') ? session(1) : response({ ok:true }), {}, {
    flush: async () => { throw new Error('Stôl čaká na uloženie.'); }
  });
  await f.auth.init(f.hooks);
  assert.equal(await f.auth.logout(), false);
  assert.equal(f.auth.isAuthenticated(), true);
  assert.equal(f.deactivations.length, 0);
  assert.equal(f.requests.some(r => r.url.endsWith('/logout')), false);
});

test('logout waits for the alchemy desk before revoking the session', async () => {
  const wait=deferred(), order=[];
  const f=fixture(request => {
    if(request.url.endsWith('/session'))return session(1);
    if(request.url.endsWith('/logout'))order.push('logout');
    return response({ok:true});
  }, {}, { flush: async () => { order.push('desk');await wait.promise;order.push('saved'); } });
  await f.auth.init(f.hooks);
  const leaving=f.auth.logout();
  assert.deepEqual(order,['desk']);
  wait.resolve();
  assert.equal(await leaving,true);
  assert.deepEqual(order,['desk','saved','logout']);
});

test('declining logout preserves unsaved personal-study drafts and the active account', async () => {
  const f = fixture(request => request.url.endsWith('/session') ? session(1) : response({ ok:true }));
  f.window.MOStudy = { hasUnsavedDrafts: () => true };
  let confirmations = 0;
  f.window.confirm = message => { confirmations++; assert.match(message, /osobnom štúdiu/); return false; };
  await f.auth.init(f.hooks);
  assert.equal(await f.auth.logout(), false);
  assert.equal(confirmations, 1); assert.equal(f.auth.isAuthenticated(), true); assert.equal(f.deactivations.length, 0);
  assert.equal(f.requests.some(request => request.url.endsWith('/logout')), false);
});

test('study and academy drafts share one explicit logout confirmation', async () => {
  const f = fixture(request => request.url.endsWith('/session') ? session(1) : response({ ok:true }));
  f.window.MOStudy = { hasUnsavedDrafts: () => true }; f.window.MOAcademy = { hasUnsavedDrafts: () => true };
  let confirmations = 0; f.window.confirm = () => { confirmations++; return true; };
  await f.auth.init(f.hooks);
  assert.equal(await f.auth.logout(), true); assert.equal(confirmations, 1); assert.equal(f.auth.isAuthenticated(), false);
});
