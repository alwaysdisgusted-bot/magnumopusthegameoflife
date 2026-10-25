const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../public/desk.js'), 'utf8');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
const clean = value => JSON.parse(JSON.stringify(value));
const empty = () => ({ version: 1, width: 1800, height: 1200, background: '#f2e6c9', strokes: [], items: [] });

function fixture(handler, initial = {}, validator = clean) {
  const storage = new Map(Object.entries(initial)), writes = [], timers = new Map(), listeners = {}, canvases = [], bindingCounts = {}, messages = [], pendingImages = [];
  let account = { id: 'merlin' }, timer = 0;
  const node = {
    style: { setProperty() {} }, dataset: {}, clientWidth: 900, value: '',
    addEventListener(name, callback) { listeners[name] = callback; bindingCounts[name] = (bindingCounts[name] || 0) + 1; }, querySelector() { return node; }, querySelectorAll() { return []; },
    classList: { toggle() {} }, setAttribute() {}, replaceChildren() {}, appendChild() {}, insertAdjacentHTML() {},
    focus() {}, scrollIntoView() {}, getContext() { return context2d; }
  };
  const context2d = new Proxy({}, { get(target, key) { return target[key] || (() => {}); } });
  const document = { getElementById() { return node; }, body: { appendChild() {} }, createElement(type) {
    if(type==='canvas') { const operations=[];const context=new Proxy({}, {get(target,key){return target[key]||((...args)=>operations.push([key,...args]));}});const canvas={operations,getContext:()=>context,toBlob:callback=>callback(new Blob(['png'])),toDataURL:()=> 'data:image/jpeg;base64,AAAA'};canvases.push(canvas);return canvas; }
    return type==='a'?{click(){},remove(){}}:node;
  } };
  const window = {
    addEventListener() {}, confirm: () => true,
    MOApp: { esc: value => String(value), toast(value) { messages.push(value); } },
    MOAuth: {
      getAccount: () => account, isAuthenticated: () => !!account,
      api: async (url, options = {}) => { const request = { account: account?.id, ...options }; writes.push(request); return handler(request); }
    },
    MODeskModel: { validateState: validator, createState: empty },
    MODeskVector: { paint() {} }
  };
  vm.runInNewContext(source, {
    window, document, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    setTimeout(callback) { const id = ++timer; timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); },
    crypto: webcrypto, URL, Blob, TextEncoder, Image: class { constructor() { pendingImages.push(this); } }, console
  });
  return { desk: window.MODesk, node, bindingCounts, storage, writes, canvases, messages, pendingImages, setAccount: value => { account = value; }, timers,
    importFile(file){listeners.change({target:{files:[file],value:'',matches:selector=>selector==='[data-desk-import]'}});},
    photos(files){listeners.change({target:{files,value:'',matches:selector=>selector==='[data-desk-photos]'}});},
    grid(key,value){listeners.change({target:{dataset:{deskGrid:key},checked:value,value:key==='opacity'?value*100:value,matches:selector=>selector==='[data-desk-grid]'}});},
    gridPNG(checked){listeners.change({target:{checked,matches:selector=>selector==='[data-desk-grid-png]'}});}
  };
}

test('desk autosave serializes changes and advances the optimistic revision', async () => {
  const first = deferred(); let puts = 0;
  const f = fixture(request => !request.method ? { state: empty(), revision: 4, updatedAt: null } : ++puts === 1 ? first.promise : { revision: 6, updatedAt: null });
  f.desk.afterRender('desk'); await settle();
  await f.desk.handleAction('desk-note');
  const saving = f.desk.flush(); await settle();
  await f.desk.handleAction('desk-note');
  first.resolve({ revision: 5, updatedAt: null }); await saving;
  assert.deepEqual(f.writes.filter(r => r.method === 'PUT').map(r => [r.body.expectedRevision, r.body.state.items.length]), [[4, 1], [5, 2]]);
  assert.equal(f.desk.hasUnsavedDrafts(), false);
  const cached = JSON.parse(f.storage.get('magnum-opus:desk:merlin'));
  assert.equal(cached.pending, false); assert.equal(cached.revision, 6); assert.equal(cached.state.items.length, 2);
});

test('new canvases save beside the primary desk, keep separate history and survive reload', async () => {
  let stored = empty(), revision = 0;
  const handler = request => {
    if (!request.method) return { state: clean(stored), revision, updatedAt: null };
    assert.equal(request.body.expectedRevision, revision);
    stored = clean(request.body.state);
    return { revision: ++revision, updatedAt: null };
  };
  const f = fixture(handler);
  f.desk.afterRender('desk'); await settle();
  await f.desk.handleAction('desk-note'); await f.desk.flush();
  await f.desk.handleAction('desk-new-canvas');
  assert.equal(stored.items.length, 1);
  assert.equal(stored.canvases.length, 1);
  assert.equal(stored.canvases[0].state.items.length, 0);
  const id = stored.canvases[0].id;
  await f.desk.handleAction('desk-note'); await f.desk.flush();
  await f.desk.switchCanvas('main');
  await f.desk.handleAction('desk-undo'); await f.desk.flush();
  assert.equal(stored.items.length, 0);
  assert.equal(stored.canvases[0].state.items.length, 1);
  await f.desk.switchCanvas(id); await f.desk.handleAction('desk-undo'); await f.desk.flush();
  assert.equal(stored.canvases[0].state.items.length, 0);
  f.desk.destroy();
  const reopened = fixture(handler);
  reopened.desk.afterRender('desk'); await settle();
  await reopened.desk.switchCanvas(id);
  await reopened.desk.handleAction('desk-note'); await reopened.desk.flush();
  assert.equal(stored.items.length, 0);
  assert.equal(stored.canvases[0].state.items.length, 1);
});

test('a failed save blocks a canvas switch and keeps both drafts recoverable', async () => {
  const original = empty();
  original.canvases = [{ id: 'second', name: 'Second', state: empty() }];
  const f = fixture(request => !request.method ? { state: original, revision: 4 } : Promise.reject(new Error('offline')));
  f.desk.afterRender('desk'); await settle();
  await f.desk.handleAction('desk-note');
  await assert.rejects(f.desk.switchCanvas('second'), /offline/);
  const cached = JSON.parse(f.storage.get('magnum-opus:desk:merlin'));
  assert.equal(cached.state.items.length, 1);
  assert.equal(cached.state.canvases[0].state.items.length, 0);
  assert.equal(cached.pending, true);
  await assert.rejects(f.desk.switchCanvas('missing'), /neexistuje/);
});

test('canvas names are trimmed, validated and saved without replacing contents', async () => {
  let stored=empty(),revision=0;
  const handler=r=>!r.method?{state:clean(stored),revision}:(stored=clean(r.body.state),{revision:++revision});
  const f=fixture(handler);f.desk.afterRender('desk');await settle();
  await assert.rejects(f.desk.renameCanvas('Primary'),/Pôvodný/);
  await f.desk.handleAction('desk-new-canvas');await f.desk.handleAction('desk-note');
  await f.desk.renameCanvas('  Moje nápady  ');
  assert.equal(stored.canvases[0].name,'Moje nápady');assert.equal(stored.canvases[0].state.items.length,1);
  for(const name of ['', ' ', 'x'.repeat(81),'bad\nname'])await assert.rejects(f.desk.renameCanvas(name),/názov/);
  await f.desk.handleAction('desk-new-canvas');
  await assert.rejects(f.desk.renameCanvas('MOJE NÁPADY'),/používa/);
  f.desk.destroy();const reopened=fixture(handler);reopened.desk.afterRender('desk');await settle();
  await reopened.desk.switchCanvas(stored.canvases[0].id);await reopened.desk.renameCanvas('Premenované');
  assert.equal(stored.canvases[0].name,'Premenované');assert.equal(stored.canvases[0].state.items.length,1);
});

test('canvas duplication copies strokes and notes with new identities and independent undo', async () => {
  const original=empty();
  original.strokes=[{id:'stroke-original',tool:'pen',color:'#112233',size:3,points:[{x:1,y:2},{x:3,y:4}]}];
  original.items=[{id:'note-original',type:'note',x:10,y:20,width:100,height:100,z:1,color:'#ffffff',text:'Keep me'}];
  let stored=original,revision=0;
  const f=fixture(r=>!r.method?{state:clean(stored),revision}:(stored=clean(r.body.state),{revision:++revision}));
  f.desk.afterRender('desk');await settle();await f.desk.handleAction('desk-duplicate-canvas');
  const clone=stored.canvases[0];
  assert.notEqual(clone.state.items[0].id,original.items[0].id);assert.notEqual(clone.state.strokes[0].id,original.strokes[0].id);
  assert.deepEqual(clone.state.strokes[0].points,original.strokes[0].points);
  assert.equal(clone.state.items[0].text,'Keep me');
  await f.desk.handleAction('desk-note');await f.desk.handleAction('desk-undo');await f.desk.flush();
  assert.equal(stored.canvases[0].state.items.length,1);assert.equal(stored.items.length,1);
  await f.desk.switchCanvas('main');await f.desk.handleAction('desk-duplicate-canvas');
  assert.notEqual(stored.canvases[0].name,stored.canvases[1].name);
  assert.deepEqual(stored.strokes,original.strokes);
});

test('collection validation rejects oversized duplication and edits before modifying the active canvas',async()=>{
  const original=empty();original.items=[{id:'n',type:'note',text:'one'}];
  let stored=original,revision=0;
  const validator=value=>{
    const count=value.items.length+(value.canvases||[]).reduce((n,c)=>n+c.state.items.length,0);
    if(count>1)throw Error('collection limit');
    return clean(value);
  };
  const f=fixture(r=>!r.method?{state:clean(stored),revision}:(stored=clean(r.body.state),{revision:++revision}),{},validator);
  f.desk.afterRender('desk');await settle();
  await assert.rejects(f.desk.handleAction('desk-duplicate-canvas'),/collection limit/);
  assert.equal(f.desk.hasUnsavedDrafts(),false);assert.equal(stored.canvases,undefined);
  await f.desk.handleAction('desk-new-canvas');
  await assert.rejects(f.desk.handleAction('desk-note'),/collection limit/);
  assert.equal(stored.canvases[0].state.items.length,0);
  await f.desk.renameCanvas('Still usable');assert.equal(stored.canvases[0].name,'Still usable');
});

test('duplication enforces the actual combined 10 MiB model limit atomically',async()=>{
  const common={exports:{}};
  Function('module',fs.readFileSync(path.join(__dirname,'../public/desk-model.js'),'utf8'))(common);
  const model=common.exports,original=model.createState();
  original.strokes=[{id:'large',tool:'pen',color:'#ffffff',size:2,points:Array.from({length:100000},()=>({x:1.2345678901234567e-100,y:9.876543210987654e-100}))}];
  const bytes=Buffer.byteLength(JSON.stringify(original));
  assert(bytes<10*1024*1024);assert(bytes*2>10*1024*1024);
  let stored=original;
  const f=fixture(r=>!r.method?{state:clean(stored),revision:0}:(stored=clean(r.body.state),{revision:1}),{},value=>model.validateState(clean(value)));
  f.desk.afterRender('desk');await settle();
  await assert.rejects(f.desk.handleAction('desk-duplicate-canvas'),/10 MB/);
  assert.equal(f.desk.hasUnsavedDrafts(),false);assert.equal(stored.canvases,undefined);
  await f.desk.handleAction('desk-note');await f.desk.flush();
  assert.equal(stored.items.length,1);assert.equal(stored.strokes[0].points.length,100000);
});

test('pending imports cannot overwrite another canvas or edits made while reading the file',async()=>{
  let stored={...empty(),canvases:[{id:'second',name:'Second',state:empty()}]},revision=0;
  const f=fixture(r=>!r.method?{state:clean(stored),revision}:(stored=clean(r.body.state),{revision:++revision}));
  f.desk.afterRender('desk');await settle();
  const first=deferred();f.importFile({size:10,text:()=>first.promise});
  await f.desk.switchCanvas('second');await f.desk.switchCanvas('main');
  first.resolve(JSON.stringify(empty()));await settle();
  assert(f.messages.some(m=>/Kanvas sa počas/.test(m)));
  const second=deferred();f.importFile({size:10,text:()=>second.promise});
  await f.desk.handleAction('desk-note');second.resolve(JSON.stringify(empty()));await settle();await f.desk.flush();
  assert(f.messages.some(m=>/pribudli úpravy/.test(m)));assert.equal(stored.items.length,1);
});

test('pending photo preparation cannot insert into a different canvas',async()=>{
  let stored={...empty(),canvases:[{id:'second',name:'Second',state:empty()}]},revision=0;
  const f=fixture(r=>!r.method?{state:clean(stored),revision}:(stored=clean(r.body.state),{revision:++revision}));
  f.desk.afterRender('desk');await settle();
  const file=new Blob(['photo'],{type:'image/png'});Object.defineProperty(file,'name',{value:'QA.png'});
  f.photos([file]);assert.equal(f.pendingImages.length,1);
  await f.desk.switchCanvas('second');
  const image=f.pendingImages[0];image.naturalWidth=100;image.naturalHeight=100;image.onload();await settle();
  assert(f.messages.some(m=>/Kanvas sa počas/.test(m)));
  assert.equal(f.desk.hasUnsavedDrafts(),false);assert.equal(stored.items.length,0);assert.equal(stored.canvases[0].state.items.length,0);
});

test('server reload cannot discard edits made while its response is pending',async()=>{
  const pending=deferred();let gets=0,stored=empty(),revision=0;
  const f=fixture(r=>!r.method?(++gets===1?{state:clean(stored),revision}:pending.promise):(stored=clean(r.body.state),{revision:++revision}));
  f.desk.afterRender('desk');await settle();
  const reload=f.desk.handleAction('desk-cloud');await settle();
  await f.desk.handleAction('desk-note');pending.resolve({state:empty(),revision:0});
  await assert.rejects(reload,/pribudli úpravy/);await f.desk.flush();
  assert.equal(stored.items.length,1);
});

test('server reload waits for an in-flight save instead of restoring its older revision',async()=>{
  const pending=deferred();let stored=empty(),revision=0,gets=0;
  const f=fixture(async r=>{
    if(!r.method){gets++;return {state:clean(stored),revision};}
    await pending.promise;stored=clean(r.body.state);return {revision:++revision};
  });
  f.desk.afterRender('desk');await settle();await f.desk.handleAction('desk-note');
  const saving=f.desk.flush();await settle();
  const reload=f.desk.handleAction('desk-cloud');await settle();assert.equal(gets,1);
  pending.resolve();await saving;await reload;
  assert.equal(gets,2);assert.equal(stored.items.length,1);assert.equal(f.desk.hasUnsavedDrafts(),false);
});

test('offline desk writes keep a recoverable local draft and retry the same revision', async () => {
  let puts = 0;
  const f = fixture(request => !request.method ? { state: empty(), revision: 7, updatedAt: null } : ++puts === 1 ? Promise.reject(new Error('offline')) : { revision: 8, updatedAt: null });
  f.desk.afterRender('desk'); await settle(); await f.desk.handleAction('desk-note');
  await assert.rejects(f.desk.flush(), /offline/);
  assert.equal(f.desk.hasUnsavedDrafts(), true);
  assert.equal(JSON.parse(f.storage.get('magnum-opus:desk:merlin')).pending, true);
  await f.desk.flush();
  assert.deepEqual(f.writes.filter(r => r.method === 'PUT').map(r => r.body.expectedRevision), [7, 7]);
  assert.equal(f.desk.hasUnsavedDrafts(), false);
});

test('conflicted cached drafts preserve their original revision after further editing', async () => {
  const cached = { state: empty(), revision: 2, pending: true, cachedAt: 1 };
  const f = fixture(() => ({ state: empty(), revision: 5, updatedAt: null }), { 'magnum-opus:desk:merlin': JSON.stringify(cached) });
  f.desk.afterRender('desk'); await settle(); await f.desk.handleAction('desk-note');
  await assert.rejects(f.desk.flush(), /inom okne/); await settle();
  assert.equal(f.writes.filter(r => r.method === 'PUT').length, 0);
  const persisted = JSON.parse(f.storage.get('magnum-opus:desk:merlin'));
  assert.equal(persisted.revision, 2); assert.equal(persisted.pending, true); assert.equal(persisted.state.items.length, 1);
});

test('an account switch during cache persistence cannot send the old desk under the new account', async () => {
  const f = fixture(request => !request.method ? { state: empty(), revision: 0, updatedAt: null } : { revision: 1, updatedAt: null });
  f.desk.afterRender('desk'); await settle(); await f.desk.handleAction('desk-note');
  const saving = f.desk.flush();
  f.setAccount({ id: 'morgana' });
  await assert.rejects(saving, error => error.code === 'STALE_DESK');
  assert.equal(f.writes.filter(r => r.method === 'PUT').length, 0);
});

test('grid controls persist through the normal save queue and undo without modifying drawing content',async()=>{
  const f=fixture(request=>!request.method?{state:empty(),revision:2,updatedAt:null}:{revision:request.body.expectedRevision+1,updatedAt:null});
  f.desk.afterRender('desk');await settle();
  f.grid('enabled',true);f.grid('spacing',50);f.grid('style','lines');f.grid('color','#123456');f.grid('opacity',.3);await f.desk.flush();
  const grid=f.writes.find(r=>r.method==='PUT').body.state.grid;
  assert.deepEqual(clean(grid),{enabled:true,spacing:50,style:'lines',color:'#123456',opacity:.3});
  await f.desk.handleAction('desk-undo');await f.desk.flush();
  assert.equal(f.writes.filter(r=>r.method==='PUT').at(-1).body.state.grid.opacity,.15);
  await f.desk.handleAction('desk-redo');await f.desk.flush();
  const latest=f.writes.filter(r=>r.method==='PUT').at(-1).body.state;assert.deepEqual(clean(latest.grid),clean(grid));assert.equal(latest.strokes.length,0);assert.equal(latest.items.length,0);
});

test('PNG excludes the grid by default and includes world-spaced lines only after explicit selection',async()=>{
  const state=empty();state.grid={enabled:true,spacing:50,style:'lines',color:'#123456',opacity:.3};
  const f=fixture(()=>({state,revision:0,updatedAt:null}));f.desk.afterRender('desk');await settle();
  await f.desk.handleAction('desk-png');
  assert.equal(f.canvases[0].operations.some(op=>op[0]==='stroke'),false);
  f.gridPNG(true);await f.desk.handleAction('desk-png');
  const exported=f.canvases[2];assert.equal(exported.width,1800);assert.equal(exported.height,1200);assert.equal(exported.operations.filter(op=>op[0]==='stroke').length,1);
  assert.ok(exported.operations.some(op=>op[0]==='moveTo'&&op[1]===50.5&&op[2]===0));
  assert.ok(exported.operations.some(op=>op[0]==='moveTo'&&op[1]===0&&op[2]===50.5));
  assert.equal(f.writes.filter(r=>r.method==='PUT').length,0,'PNG preferences do not mutate the account snapshot');
});

test('embedded desk shows the same legacy state without writing; explicit edits expand it and undo restores it', async () => {
  const state = empty();
  state.items.push({ id: 'old-note', type: 'note', x: 40, y: 40, width: 220, height: 180, z: 1, color: '#fff2a8', text: 'Original note' });
  const f = fixture(r => !r.method ? { state, revision: 4, updatedAt: null } : { revision: r.body.expectedRevision + 1 });
  f.desk.embed(f.node); await settle(); await f.desk.flush();
  assert.equal(f.writes.filter(r => r.method === 'PUT').length, 0);
  f.desk.embed(null); f.desk.embed(f.node); f.desk.embed(null); f.desk.embed(f.node);
  assert.equal(f.bindingCounts.click, 1); assert.equal(f.bindingCounts.pointerdown, 1);
  await f.desk.handleAction('desk-note'); await f.desk.flush();
  const saved = f.writes.find(r => r.method === 'PUT').body.state;
  assert.equal(saved.width, 10000); assert.equal(saved.height, 10000); assert.equal(saved.background, '#000000');
  assert.deepEqual(saved.items[0], state.items[0]); assert.equal(saved.items.length, 2);
  await f.desk.handleAction('desk-undo'); await f.desk.flush();
  const restored = f.writes.filter(r => r.method === 'PUT').at(-1).body.state;
  assert.equal(restored.width, 1800); assert.equal(restored.background, '#f2e6c9'); assert.deepEqual(restored.items, state.items);
});

test('large desk PNG allocation is bounded and never resizes stored data', async () => {
  const state = { ...empty(), width: 10000, height: 10000, background: '#000000' };
  const f = fixture(() => ({ state, revision: 0, updatedAt: null }));
  f.desk.afterRender('desk'); await settle(); await f.desk.handleAction('desk-png');
  assert.equal(f.canvases.length, 2);
  for (const canvas of f.canvases) { assert.equal(canvas.width, 4096); assert.equal(canvas.height, 4096); }
  assert.equal(f.writes.filter(r => r.method === 'PUT').length, 0);
  assert.equal(state.width, 10000); assert.equal(state.height, 10000);
});
