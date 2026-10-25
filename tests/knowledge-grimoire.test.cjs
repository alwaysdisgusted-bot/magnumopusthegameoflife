'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');

function load(name, dependencies = {}) {
  const filename = path.resolve(__dirname, '../server/' + name + '.ts');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  });
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = loaded.require.bind(loaded);
  loaded.require = id => dependencies[id] || original(id);
  loaded._compile(compiled.outputText, filename);
  return loaded.exports;
}

const auth = load('auth');
const { handleKnowledgeGrimoireRequest } = load('knowledge-grimoire', { './auth': auth });
const model = require('../server/knowledge-grimoire-model.mjs').default;
const hash = value => createHash('sha256').update(value).digest('hex');

class Statement {
  constructor(db, sql, values = []) { this.db = db; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.db, this.sql, values); }
  async first() { return this.db.sqlite.prepare(this.sql).get(...this.values) || null; }
  async all() { return { success: true, results: this.db.sqlite.prepare(this.sql).all(...this.values), meta: {} }; }
  async run() {
    const result = this.db.sqlite.prepare(this.sql).run(...this.values);
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }
}

class TestD1 {
  transactions = Promise.resolve();
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys=ON');
    const folder = path.resolve(__dirname, '../drizzle');
    for (const name of fs.readdirSync(folder).filter(file => file.endsWith('.sql')).sort()) {
      this.sqlite.exec(fs.readFileSync(path.join(folder, name), 'utf8'));
    }
  }
  prepare(sql) { return new Statement(this, sql); }
  async batch(statements) {
    const operation = this.transactions.then(async () => {
      this.sqlite.exec('BEGIN IMMEDIATE');
      try {
        const result = [];
        for (const statement of statements) result.push(await statement.run());
        this.sqlite.exec('COMMIT');
        return result;
      } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
    });
    this.transactions = operation.catch(() => undefined);
    return operation;
  }
}

class TestBucket {
  objects = new Map();
  async put(key, contents) {
    this.objects.set(key, Buffer.from(contents instanceof ArrayBuffer ? new Uint8Array(contents) : contents));
    return { key };
  }
  async get(key) {
    const bytes = this.objects.get(key);
    return bytes === undefined ? null : {
      size: bytes.length,
      body: Uint8Array.from(bytes),
      text: async () => bytes.toString('utf8'),
    };
  }
  async delete(key) { this.objects.delete(key); }
}

function fixture(t) {
  const env = { DB: new TestD1(), BUCKET: new TestBucket(), DEV: true };
  t.after(() => env.DB.sqlite.close());
  for (const id of ['A', 'B']) {
    env.DB.sqlite.prepare(
      'INSERT INTO wizard_accounts(id,owner_id,normalized_name,display_name,password_hash,created_at) VALUES(?,?,?,?,?,?)',
    ).run(id, 'owner-' + id, 'wizard-' + id, 'Čarodej ' + id, 'not-used', Date.now());
    env.DB.sqlite.prepare(
      'INSERT INTO wizard_sessions(token_hash,account_id,owner_id,csrf_value,expires_at) VALUES(?,?,?,?,?)',
    ).run(hash(hash('session-' + id)), id, 'owner-' + id, hash('csrf-' + id), Date.now() + 86400000);
    const game = require('../server/game-model.mjs').default.createState();
    env.BUCKET.objects.set('save-' + id, Buffer.from(JSON.stringify(game)));
    env.DB.sqlite.prepare('INSERT INTO wizard_saves(account_id,revision,object_key,updated_at) VALUES(?,1,?,?)')
      .run(id, 'save-' + id, Date.now());
  }
  return env;
}

const termRoute = '/api/knowledge/grimoire/terminology';
const readingRoute = '/api/knowledge/grimoire/reading';
async function readingTurn(env, documentId, index, extra = {}, options = {}) {
  return call(env,{method:'POST',route:readingRoute,body:{
    eventId:'11111111-1111-4111-8111-'+String(index).padStart(12,'0'),documentId,
    fromPage:index%2?1:2,toPage:index%2?2:1,expectedGameRevision:1,...extra},...options});
}

test('reading turns award exactly one coin on25 and50 including repeated backward turns, preserving the remainder', async t => {
  const env=fixture(t),sources=await seedSources(env),id=sources.documents[0].id;
  assert.equal((await call(env,{route:readingRoute})).body.turns,0);
  for(let index=1;index<=51;index++){
    const result=await readingTurn(env,id,index,{expectedGameRevision:index>50?3:index>25?2:1});
    assert.equal(result.response.status,200,JSON.stringify(result.body));
    assert.equal(result.body.awarded,index%25===0);
    assert.equal(result.body.turns,index);
    assert.equal(result.body.towardsReward,index%25);
    if(index%25===0)assert.equal(result.body.save.state.ledger.at(-1).coins,1);
  }
  assert.deepEqual((await call(env,{route:readingRoute})).body,{turns:51,towardsReward:1});
  assert.equal((await auth.loadSave(env,'A','owner-A')).state.ledger.length,2);
});

test('reading turn retries and response loss count one event once and retain the committed reward object', async t => {
  const env=fixture(t),sources=await seedSources(env),id=sources.documents[0].id;
  for(let index=1;index<=24;index++)await readingTurn(env,id,index);
  const original=env.DB.batch.bind(env.DB);
  env.DB.batch=async statements=>{await original(statements);throw Error('lost response');};
  const awarded=await readingTurn(env,id,25);
  assert.equal(awarded.response.status,200);
  assert.equal(awarded.body.turns,25);
  assert.equal(awarded.body.save.state.ledger.length,1);
  assert.equal((await readingTurn(env,id,25)).body.turns,25);
  const saved=await auth.loadSave(env,'A','owner-A');
  assert.equal(saved.revision,2);assert.equal(saved.state.ledger.length,1);
  assert.equal((await readingTurn(env,id,25,{fromPage:2,toPage:3})).response.status,409);
});

test('reading turns reject boundary no-ops, skips, foreign documents, extra counts and invalid CSRF', async t => {
  const env=fixture(t),sources=await seedSources(env),id=sources.documents[0].id;
  for(const extra of [{toPage:1},{toPage:3},{fromPage:0,toPage:1},{count:25},{coins:1}]){
    assert.equal((await readingTurn(env,id,1,extra)).response.status,422);
  }
  assert.equal((await readingTurn(env,id,1,{}, {account:'B'})).response.status,404);
  assert.equal((await readingTurn(env,id,1,{}, {noCsrf:true})).response.status,403);
  assert.equal((await call(env,{route:readingRoute})).body.turns,0);
});

test('reading25 stale game revision rolls counter and receipt back; retry can complete', async t => {
  const env=fixture(t),sources=await seedSources(env),id=sources.documents[0].id;
  for(let index=1;index<=24;index++)await readingTurn(env,id,index);
  assert.equal((await readingTurn(env,id,25,{expectedGameRevision:99})).response.status,409);
  assert.equal((await call(env,{route:readingRoute})).body.turns,24);
  assert.equal((await readingTurn(env,id,25)).body.turns,25);
});

test('reading concurrent crossing attempts yield one credit and the losing event can retry without loss', async t => {
  const env=fixture(t),sources=await seedSources(env),id=sources.documents[0].id;
  for(let index=1;index<=24;index++)await readingTurn(env,id,index);
  const results=await Promise.all([readingTurn(env,id,25),readingTurn(env,id,26)]);
  assert.deepEqual(results.map(r=>r.response.status).sort(),[200,409]);
  assert.equal((await auth.loadSave(env,'A','owner-A')).state.ledger.length,1);
  const loser=results[0].response.status===409?25:26;
  assert.equal((await readingTurn(env,id,loser,{expectedGameRevision:2})).body.turns,26);
});

test('reading reward ledger cannot be forged, removed or modified by a normal game save', async t => {
  const env=fixture(t),sources=await seedSources(env),id=sources.documents[0].id;
  for(let index=1;index<=25;index++)await readingTurn(env,id,index);
  const saved=await auth.loadSave(env,'A','owner-A');
  async function put(state){return auth.handleAuth(request({route:'/api/save',method:'PUT',body:{expectedRevision:2,state}}),env);}
  assert.equal((await put({...saved.state,ledger:[]})).status,409);
  const altered=structuredClone(saved.state);altered.ledger[0].label='Forged';
  assert.equal((await put(altered)).status,409);
  assert.equal((await put(saved.state)).status,200);
});

test('reading source revision race and R2 failure do not consume the25th turn or credit', async t => {
  const env=fixture(t),sources=await seedSources(env),id=sources.documents[0].id;
  for(let index=1;index<=24;index++)await readingTurn(env,id,index);
  const put=env.BUCKET.put.bind(env.BUCKET);
  env.BUCKET.put=async()=>null;
  assert.equal((await readingTurn(env,id,25)).response.status,503);
  env.BUCKET.put=put;
  const batch=env.DB.batch.bind(env.DB);
  env.DB.batch=async statements=>{
    env.DB.sqlite.prepare('UPDATE knowledge_grimoire_states SET revision=revision+1 WHERE account_id=?').run('A');
    return batch(statements);
  };
  assert.equal((await readingTurn(env,id,25)).response.status,409);
  assert.equal((await call(env,{route:readingRoute})).body.turns,24);
  assert.equal((await auth.loadSave(env,'A','owner-A')).state.ledger.length,0);
});
  const termDetails = (changes = {}) => ({fieldId:'social-sciences',categoryId:'psychology-cognition',term:'Syntetický vlastný pojem',
    description:'Testovací pojem',note:'',documentIds:[],folderIds:[],collectionIds:[],...changes});
  async function seedSources(env) {
    const state = model.createState();
    state.tabs.push({id:'tab',title:'Test'});
    state.folders.push({id:'folder',tabId:'tab',parentId:null,title:'Zdroje',note:''});
    state.favoriteWords.push({id:'legacy',word:'Poznanie',normalizedWord:'poznanie',note:'Pôvodná poznámka'});
    state.wordCollections.push({id:'collection',favoriteId:'legacy',title:'Staršia zbierka',note:'',
      kind:'tab',parentTabId:null,includedDocumentIds:[],excludedDocumentIds:[],uploadFolderId:null});
    for (let index=1;index<=3;index++) {
      const id = 'map_' + hash('synthetic-' + index);
      state.documents.push({id,fileId:id,folderId:'folder',name:'Rovnaký názov.txt',mediaType:'text/plain',size:1,addedAt:'2026-10-23',mapDocumentId:'source-'+index});
      state.textSegments.push({id:'seg'+index,sourceId:id,segmentNumber:0,pageNumber:null,text:'Poznanie a kognícia.'});
    }
    assert.equal((await call(env,{method:'PUT',body:{expectedRevision:0,state}})).response.status,200);
    return state;
  }
  async function createTerm(env, changes = {}, account = 'A', creationKey = '11111111-1111-4111-8111-111111111111') {
    return call(env,{account,method:'POST',route:termRoute,body:{operation:'create',creationKey,details:termDetails(changes)}});
  }
  async function saveTerm(env, term, changes, extra = {}) {
    const details = termDetails(Object.fromEntries(Object.keys(termDetails()).map(key => [key,term[key]])));
    return call(env,{method:'POST',route:termRoute,body:{operation:'save',id:term.id,expectedRevision:term.revision,
      expectedGameRevision:1,details:{...details,...changes},...extra}});
  }

  test('terminology creation has server identities, owner isolation and retry identity without retro-registration', async t => {
    const env = fixture(t); await seedSources(env);
    assert.deepEqual((await call(env,{route:termRoute})).body.terms,[]);
    const created = await createTerm(env);
    assert.equal(created.response.status,201,JSON.stringify(created.body));
    const id = created.body.termId;
    assert.match(id,/^term_[a-f0-9-]{36}$/);
    assert.equal((await createTerm(env)).body.termId,id);
    assert.equal((await call(env,{account:'B',route:termRoute})).body.terms.length,0);
    const foreign = await call(env,{account:'B',method:'POST',route:termRoute,body:{
      operation:'save',id,expectedRevision:1,details:termDetails()}});
    assert.equal(foreign.response.status,404);
    assert.equal((await call(env,{route:termRoute})).body.favoriteWords[0].id,'legacy');
  });

  test('nested terminology keeps owner-scoped parents and a stable recursive folder path without retro rewards', async t => {
    const env = fixture(t);
    const catalog = require('../server/knowledge-catalog.mjs').default.fields;
    const field = catalog.find(item => item.id === 'social-sciences');
    const category = field.categories.find(item => item.id === 'psychology-cognition');
    const parent = {term:category.terms[0]};
    const first = await createTerm(env,{term:'Child',parent});
    assert.equal(first.response.status,201,JSON.stringify(first.body));
    const child = first.body.catalog.terms[0];
    const second = await createTerm(env,{term:'Grandchild',parent:{termId:child.id}},'A','22222222-2222-4222-8222-222222222222');
    assert.equal(second.response.status,201,JSON.stringify(second.body));
    const grandchild = second.body.catalog.terms.find(item => item.term === 'Grandchild');
    assert.deepEqual(grandchild.folderPath.map(item => item.title),[field.name,category.name,parent.term,'Child','Grandchild']);
    assert.equal((await call(env,{route:termRoute})).body.terms.at(-1).parent.termId,child.id);
    const foreign = await createTerm(env,{parent:{termId:child.id}},'B');
    assert.equal(foreign.response.status,422);
    assert.equal((await createTerm(env,{parent:{termId:'missing'}},'A','33333333-3333-4333-8333-333333333333')).response.status,422);
    const renamed = await saveTerm(env,child,{term:'Child renamed',parent});
    assert.equal(renamed.response.status,200,JSON.stringify(renamed.body));
    const updated = renamed.body.catalog.terms.find(item => item.id === grandchild.id);
    assert.equal(updated.folderPath.at(-2).title,'Child renamed');
    assert.equal(updated.folderPath.at(-2).key,child.id);
    assert.equal((await saveTerm(env,grandchild,{parent:{termId:grandchild.id}})).response.status,422);
    assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM knowledge_term_rewards').get().n,0);
  });

  test('terminology rewards require three accessible distinct documents and survive unlink/relink exactly once', async t => {
    const env = fixture(t), sources = await seedSources(env);
    let term = (await createTerm(env)).body.catalog.terms[0];
    let result = await saveTerm(env,term,{documentIds:[sources.documents[0].id,sources.documents[0].id]});
    assert.equal(result.response.status,200); assert.equal(result.body.awarded,false);
    term = result.body.catalog.terms[0];
    result = await saveTerm(env,term,{documentIds:[sources.documents[0].id],folderIds:['folder'],collectionIds:['collection']});
    assert.equal(result.response.status,200);
    assert.equal(result.body.awarded,true);
    assert.equal(result.body.catalog.terms[0].sourceIds.length,3);
    assert.equal(result.body.save.state.ledger.filter(item=>item.type==='knowledge-term').length,1);
    assert.equal(result.body.save.state.ledger[0].coins,10);
    const id = term.id; term=result.body.catalog.terms[0];
    result=await saveTerm(env,term,{documentIds:[],folderIds:[],collectionIds:[]},{expectedGameRevision:2});
    term=result.body.catalog.terms[0];
    result=await saveTerm(env,term,{folderIds:['folder']},{expectedGameRevision:2});
    assert.equal(result.body.awarded,false);
    assert.equal(result.body.catalog.terms[0].id,id);
    assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM knowledge_term_rewards').get().n,1);
    const save=await auth.handleAuth(request({route:'/api/save'}),env);
    assert.equal((await save.json()).state.ledger.length,1);
    assert.equal((await call(env)).body.state.documents.length,3);
  });

  test('term rename and branch movement retain source references and cannot award again', async t => {
    const env=fixture(t); await seedSources(env);
    let term=(await createTerm(env)).body.catalog.terms[0];
    let result=await saveTerm(env,term,{folderIds:['folder']});
    term=result.body.catalog.terms[0];
    const id=term.id;
    result=await saveTerm(env,term,{term:'Nový názov bez zmeny identity',categoryId:'sociology'},{expectedGameRevision:2});
    assert.equal(result.body.catalog.terms[0].id,id);
    assert.deepEqual(result.body.catalog.terms[0].folderIds,['folder']);
    assert.equal(result.body.awarded,false);
    assert.equal(result.body.catalog.terms[0].sourceIds.length,3);
  });

  test('stale game or source snapshot rolls award, membership and receipt back atomically', async t => {
    const env=fixture(t); await seedSources(env);
    const term=(await createTerm(env)).body.catalog.terms[0];
    const stale=await saveTerm(env,term,{folderIds:['folder']},{expectedGameRevision:99});
    assert.equal(stale.response.status,409);
    assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM knowledge_term_rewards').get().n,0);
    assert.deepEqual((await call(env,{route:termRoute})).body.terms[0].folderIds,[]);
    const original=env.DB.batch.bind(env.DB);
    env.DB.batch=async statements=>{
      env.DB.sqlite.prepare('UPDATE knowledge_grimoire_states SET revision=revision+1 WHERE account_id=?').run('A');
      return original(statements);
    };
    const raced=await saveTerm(env,term,{folderIds:['folder']});
    assert.equal(raced.response.status,409);
    assert.equal(env.DB.sqlite.prepare('SELECT revision FROM wizard_saves WHERE account_id=?').get('A').revision,1);
    assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM knowledge_term_rewards').get().n,0);
    assert.deepEqual((await call(env,{route:termRoute})).body.terms[0].folderIds,[]);
  });

  test('concurrent duplicate credit and lost committed response keep a single authoritative receipt', async t => {
    const env=fixture(t); await seedSources(env);
    const term=(await createTerm(env)).body.catalog.terms[0];
    const original=env.DB.batch.bind(env.DB);
    env.DB.batch=async statements=>{await original(statements);throw new Error('response disconnected after commit');};
    const result=await saveTerm(env,term,{folderIds:['folder']});
    assert.equal(result.response.status,200);
    assert.equal(result.body.save.state.ledger.filter(item=>item.type==='knowledge-term').length,1);
    const duplicate=await saveTerm(env,term,{folderIds:['folder']});
    assert.equal(duplicate.response.status,409);
    assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM knowledge_term_rewards').get().n,1);
  });

  test('terminology rejects foreign source IDs, premade terms, invalid CSRF and fabricated reward counts', async t=>{
    const env=fixture(t); await seedSources(env);
    const term=(await createTerm(env)).body.catalog.terms[0];
    assert.notEqual((await saveTerm(env,term,{documentIds:['foreign']})).response.status,200);
    assert.equal((await call(env,{method:'POST',route:termRoute,noCsrf:true,body:{operation:'create',
      creationKey:'11111111-1111-4111-8111-111111111111',details:termDetails()}})).response.status,403);
    assert.equal((await createTerm(env,{term:'kognícia'},'B','22222222-2222-4222-8222-222222222222')).response.status,422);
    const invalid=await call(env,{method:'POST',route:termRoute,body:{operation:'save',id:term.id,expectedRevision:1,
      expectedGameRevision:1,details:{...termDetails(),sourceCount:3}}});
    assert.equal(invalid.response.status,422);
  });

  test('normal game save cannot forge, alter or erase an authoritative term reward', async t=>{
    const env=fixture(t); await seedSources(env);
    const term=(await createTerm(env)).body.catalog.terms[0];
    const result=await saveTerm(env,term,{folderIds:['folder']});
    const state=result.body.save.state;
    async function put(state) {
      const response=await auth.handleAuth(request({route:'/api/save',method:'PUT',body:{expectedRevision:2,state}}),env);
      return response.status;
    }
    assert.equal(await put({...state,ledger:[]}),409);
    const altered=structuredClone(state); altered.ledger[0].label='Vymyslená odmena';
    assert.equal(await put(altered),409);
    assert.equal(await put(state),200);
  });

function request(options = {}) {
  const { account = 'A', method = 'GET', body, route = '/api/knowledge/grimoire', noCsrf, noSession, noOwner } = options;
  const headers = {
    Origin: 'http://127.0.0.1:4175',
    'oai-authenticated-user-id': 'owner-' + account,
    Cookie: 'mo-session=' + hash('session-' + account),
    'X-MO-Request': '1',
  };
  if (noSession) delete headers.Cookie;
  if (noOwner) delete headers['oai-authenticated-user-id'];
  if (method !== 'GET') headers['X-MO-CSRF'] = noCsrf ? '' : hash('csrf-' + account);
  const multipart = body instanceof FormData;
  if ((body !== undefined && !multipart) || (method === 'DELETE' && body === undefined)) headers['Content-Type'] = 'application/json';
  return new Request('http://127.0.0.1:4175' + route, {
    method, headers, body: body === undefined ? method === 'DELETE' ? '{}' : undefined : multipart ? body : JSON.stringify(body),
  });
}

async function call(env, options = {}) {
  const response = await handleKnowledgeGrimoireRequest(request(options), env);
  assert.ok(response);
  return {
    response,
    body: response.headers.get('Content-Type')?.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer()),
  };
}

function uploadForm(id = 'document-1', bytes = Buffer.from('originál'), name = 'zapisnik.txt') {
  const form = new FormData();
  form.set('id', id);
  form.set('file', new Blob([bytes], { type: 'text/plain' }), name);
  return form;
}

test('simultaneous different source saves commit only one credit and explicitly reject the losing edit', async t => {
  const env=fixture(t); await seedSources(env);
  const term=(await createTerm(env)).body.catalog.terms[0];
  const results=await Promise.all([saveTerm(env,term,{folderIds:['folder'],note:'First edit'}),
    saveTerm(env,term,{folderIds:['folder'],note:'Second edit'})]);
  assert.deepEqual(results.map(result=>result.response.status).sort(),[200,409]);
  const winner=results.find(result=>result.response.status===200);
  assert.equal((await call(env,{route:termRoute})).body.terms[0].note,winner.body.catalog.terms[0].note);
  assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM knowledge_term_rewards').get().n,1);
  const saved=await auth.loadSave(env,'A','owner-A');
  assert.equal(saved.revision,2);
  assert.equal(saved.state.ledger.length,1);
});

test('Grimoire API requires the local owner session and keeps accounts isolated', async t => {
  const env = fixture(t);
  const first = await call(env);
  assert.equal(first.body.revision, 0);
  assert.deepEqual(first.body.state, model.createState());
  for (const options of [{ noSession: true }]) {
    assert.equal((await call(env, options)).response.status, 401);
    assert.equal((await call(env, { ...options, method: 'PUT', body: { expectedRevision: 0, state: model.createState() } })).response.status, 401);
  }
  assert.equal((await call(env, { method: 'PUT', noCsrf: true, body: { expectedRevision: 0, state: model.createState() } })).response.status, 403);
  const saved = await call(env, { method: 'PUT', body: { expectedRevision: 0, state: model.createState() } });
  assert.equal(saved.response.status, 200);
  assert.equal((await call(env, { account: 'B' })).body.revision, 0);
});

test('map original references remain owner-scoped and unlink never removes an original', async t => {
  const env = fixture(t);
  const state = model.createState();
  const id = 'map_' + 'a'.repeat(64);
  state.tabs.push({ id: 'tab', title: 'Mapa' });
  state.folders.push({ id: 'folder', tabId: 'tab', parentId: null, title: 'Originály', note: '' });
  state.documents.push({ id, fileId: id, folderId: 'folder', name: 'original.txt', mediaType: 'text/plain', size: 3,
    addedAt: '2026-10-23', mapDocumentId: 'map-original' });
  state.mapLinks.push({ documentId: id, fieldId: 'psychology', categoryId: 'cognition', term: 'Kognícia' });
  assert.equal((await call(env, { method: 'PUT', body: { expectedRevision: 0, state } })).response.status, 200);
  assert.equal((await call(env)).body.state.mapLinks.length, 1);
  assert.equal((await call(env, { account: 'B' })).body.state.documents.length, 0);
  state.mapLinks = [];
  assert.equal((await call(env, { method: 'PUT', body: { expectedRevision: 1, state } })).response.status, 200);
  const reloaded = await call(env);
  assert.equal(reloaded.body.state.documents.length, 1);
  assert.equal(reloaded.body.state.mapLinks.length, 0);
  assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM knowledge_grimoire_files').get().n, 0);
});

test('revisioned snapshots reject stale writes without overwriting the stored version', async t => {
  const env = fixture(t);
  const state = model.createState();
  state.tabs.push({ id: 'tab-1', title: 'Lokálne' });
  assert.equal((await call(env, { method: 'PUT', body: { expectedRevision: 0, state } })).body.revision, 1);
  const stale = model.createState();
  stale.tabs.push({ id: 'tab-2', title: 'Zastarané' });
  assert.equal((await call(env, { method: 'PUT', body: { expectedRevision: 0, state: stale } })).response.status, 409);
  assert.deepEqual((await call(env)).body.state.tabs, [{ id: 'tab-1', title: 'Lokálne' }]);
});

test('the Supabase import endpoint is no longer registered', async t => {
  const env = fixture(t);
  const response = await handleKnowledgeGrimoireRequest(request({
    method: 'POST',
    route: '/api/knowledge/grimoire/import',
    body: { expectedRevision: 0, state: model.createState(), sourceHash: 'a'.repeat(64) },
  }), env);
  assert.equal(response, null);
});

test('original documents are account-scoped and download with private no-store headers', async t => {
  const env = fixture(t);
  const form = uploadForm();
  const added = await call(env, { method: 'POST', route: '/api/knowledge/grimoire/files', body: form });
  assert.equal(added.response.status, 201);
  assert.equal((await call(env, { account: 'B', route: '/api/knowledge/grimoire/files/document-1' })).response.status, 404);
  const downloaded = await call(env, { route: '/api/knowledge/grimoire/files/document-1' });
  assert.equal(downloaded.response.status, 200);
  assert.match(downloaded.response.headers.get('Cache-Control'), /no-store, private/);
  assert.equal(downloaded.body.toString(), 'originál');
  assert.equal((await call(env, { method: 'DELETE', route: '/api/knowledge/grimoire/files/document-1' })).response.status, 200);
});

test('uploaded originals are retained when referenced and unsupported file types are rejected', async t => {
  const env = fixture(t);
  assert.equal((await call(env, {
    method: 'POST', route: '/api/knowledge/grimoire/files',
    body: uploadForm('bad-1', Buffer.from('x'), 'payload.exe'),
  })).response.status, 422);
  await call(env, { method: 'POST', route: '/api/knowledge/grimoire/files', body: uploadForm() });
  const state = model.createState();
  state.tabs.push({ id: 'tab-1', title: 'Knižnica' });
  state.folders.push({ id: 'folder-1', tabId: 'tab-1', parentId: null, title: 'Záznamy', note: '' });
  state.documents.push({
    id: 'document-1', folderId: 'folder-1', fileId: 'document-1', name: 'zapisnik.txt',
    mediaType: 'text/plain', size: 9, addedAt: '2026-10-23T00:00:00.000Z',
  });
  assert.equal((await call(env, { method: 'PUT', body: { expectedRevision: 0, state } })).response.status, 200);
  assert.equal((await call(env, { method: 'DELETE', route: '/api/knowledge/grimoire/files/document-1' })).response.status, 409);
  assert.equal((await call(env, { route: '/api/knowledge/grimoire/files/document-1' })).body.toString(), 'originál');
});

test('search endpoint returns only the authenticated account original records', async t => {
  const env = fixture(t);
  const state = model.createState();
  state.tabs.push({ id: 'tab-1', title: 'Kognícia' });
  assert.equal((await call(env, { method: 'PUT', body: { expectedRevision: 0, state } })).response.status, 200);
  const found = await call(env, { route: '/api/knowledge/grimoire/search?q=kognicia' });
  assert.equal(found.body.results[0].kind, 'grimoire-tab');
  assert.equal((await call(env, { account: 'B', route: '/api/knowledge/grimoire/search?q=kognicia' })).body.results.length, 0);
});
