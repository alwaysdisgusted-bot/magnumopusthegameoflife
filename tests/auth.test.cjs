'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');

// Compile only the server module in memory; do not modify application files.
const filename = path.resolve(__dirname, '../server/auth.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(path.dirname(filename));
loaded._compile(compiled.outputText, filename);
const A = loaded.exports;
const M = require('../server/game-model.cjs');

class Statement {
  constructor(db, sql, values = []) { this.db = db; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.db, this.sql, values); }
  async first() { return this.db.sqlite.prepare(this.sql).get(...this.values) || null; }
  async all() { return {success:true,results:this.db.sqlite.prepare(this.sql).all(...this.values),meta:{}}; }
  execute() {
    const result = this.db.sqlite.prepare(this.sql).run(...this.values);
    if (this.db.throwAfterSave && this.sql.startsWith('UPDATE wizard_saves')) { this.db.throwAfterSave = false; throw new Error('Injected transport error after commit'); }
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }
  async run() { return this.execute(); }
}
class TestD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE wizard_accounts(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL UNIQUE,normalized_name TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL,password_hash TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE wizard_sessions(token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES wizard_accounts(id) ON DELETE CASCADE,owner_id TEXT NOT NULL,csrf_value TEXT NOT NULL,expires_at INTEGER NOT NULL);
      CREATE TABLE wizard_saves(account_id TEXT PRIMARY KEY REFERENCES wizard_accounts(id) ON DELETE CASCADE,revision INTEGER NOT NULL,object_key TEXT NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE auth_attempts(bucket_key TEXT PRIMARY KEY,window_started_at INTEGER NOT NULL,attempts INTEGER NOT NULL);`);
    this.sqlite.exec(fs.readFileSync(path.resolve(__dirname,'../drizzle/0011_rapid_gideon.sql'),'utf8'));
    this.sqlite.exec(fs.readFileSync(path.resolve(__dirname,'../drizzle/0012_adorable_hydra.sql'),'utf8'));
  }
  prepare(sql) { return new Statement(this, sql); }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (let i = 0; i < statements.length; i++) {
        if (this.failBatchAt === i + 1) { this.failBatchAt = null; throw new Error('Injected batch failure'); }
        results.push(statements[i].execute());
      }
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
  count(table) { return this.sqlite.prepare('SELECT count(*) n FROM ' + table).get().n; }
}
class TestBucket {
  objects = new Map();
  deleted = [];
  async put(key, contents) {
    if (this.failPut) { this.failPut = false; throw new Error('Injected R2 failure'); }
    this.objects.set(key, contents);
    if (this.barrier) await this.barrier();
    return { key };
  }
  async get(key) {
    const text = this.objects.get(key);
    return text === undefined ? null : { size: Buffer.byteLength(text), text: async () => text };
  }
  async delete(key) { this.deleted.push(key); this.objects.delete(key); }
}
function fixture(t) {
  const env = { DB: new TestD1(), BUCKET: new TestBucket() };
  t.after(() => env.DB.sqlite.close());
  return env;
}
const PASSWORD = 'Silné heslo 12345';
function request(route, options = {}) {
  const { owner = 'owner-A', method = 'GET', body, cookie, csrf, origin, url = 'https://game.example', headers = {} } = options;
  const allHeaders = { ...headers };
  if (owner !== null) allHeaders['oai-authenticated-user-id'] = owner;
  if (cookie) allHeaders.Cookie = cookie;
  if (csrf !== undefined) allHeaders['X-MO-CSRF'] = csrf;
  if (method !== 'GET') { allHeaders.Origin = origin === undefined ? url : origin; allHeaders['X-MO-Request'] ??= '1'; allHeaders['Content-Type'] ??= 'application/json'; }
  return new Request(url + route, { method, headers: allHeaders, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function call(env, route, options) { return A.handleAuth(request(route, options), env); }
async function register(env, name = 'Čarodej Peter', options = {}) {
  const response = await call(env, '/api/auth/register', { method: 'POST', body: { name, password: PASSWORD }, ...options });
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  return { response, payload: await response.json(), cookie: response.headers.get('Set-Cookie').split(';')[0] };
}

test('Unicode names normalize consistently and scrypt hashes use strong fixed parameters', async () => {
  assert.equal(A.normalizeName('  ČARODEJ  Peter ').normalized, A.normalizeName('čarodej peter').normalized);
  assert.equal(A.normalizeName('ＳＴＲＡＳＳＥ').normalized, A.normalizeName('Straße').normalized);
  assert.equal(A.normalizeName('STRAẞE').normalized, A.normalizeName('Straße').normalized);
  assert.equal(A.normalizeName('ΟΣΣ').normalized, A.normalizeName('οσς').normalized);
  assert.throws(() => A.normalizeName('<script>'));
  const one = await A.hashPassword(PASSWORD), two = await A.hashPassword(PASSWORD);
  assert.notEqual(one, two);
  assert.match(one, /^\$scrypt\$N=32768,r=8,p=3\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
  assert.equal(await A.verifyPassword(PASSWORD, one), true);
  assert.equal(await A.verifyPassword(PASSWORD + 'x', one), false);
  assert.equal(await A.verifyPassword(PASSWORD, one.replace('32768', '1048576')), false);
  await assert.rejects(A.hashPassword('short'));
});

test('No account operations bypass Sites identity; writes reject invalid Origin, JSON and custom headers', async t => {
  const env = fixture(t);
  let response = await call(env, '/api/auth/session', { owner: null });
  assert.deepEqual(await response.json(), { account: null, requiresSiteLogin: true });
  for (const route of ['/api/auth/register', '/api/auth/login', '/api/auth/logout', '/api/save']) {
    response = await call(env, route, { owner: null, method: route === '/api/save' ? 'PUT' : 'POST', body: {} });
    assert.equal(response.status, 401);
    assert.match(response.headers.get('Cache-Control'), /no-store/);
  }
  for (const origin of ['null', 'https://evil.example', 'https://game.example.evil.test', 'https://magnum-opus-game-of-life.petojasic.chatgpt.site.evil.test']) {
    response = await call(env, '/api/auth/register', { method: 'POST', body: {}, origin });
    assert.equal(response.status, 403);
  }
  response = await call(env, '/api/auth/login', { method: 'POST', body: {}, headers: {'X-MO-Request':'0'} });
  assert.equal(response.status, 403);
  response = await call(env, '/api/auth/login', { method: 'POST', body: {}, headers: {'Content-Type':'text/plain'} });
  assert.equal(response.status, 415);
  A.guardWrite(request('/api/save', {method:'PUT',body:{},url:'https://dispatch.internal',origin:'https://magnum-opus-game-of-life.petojasic.chatgpt.site'}));
});

test('Registration creates one owned account, opaque session and private validated cloud state', async t => {
  const env = fixture(t);
  const initialState=M.createState();
  M.addBook(initialState,{title:'Moja kniha',total:100});
  const signed=await register(env,'Čarodej Peter',{body:{name:'Čarodej Peter',password:PASSWORD,initialState}});
  assert.equal(signed.payload.save.revision,1);
  assert.equal(signed.payload.save.state.books[0].title,'Moja kniha');
  assert.equal(signed.payload.save.state.profile.name,'Čarodej Peter');
  const cookie=signed.response.headers.get('Set-Cookie');
  assert.match(cookie,/^__Host-mo-session=[a-f0-9]{64};/);
  for(const attribute of ['Path=/','HttpOnly','SameSite=Lax','Secure','Max-Age=2592000']) assert(cookie.includes(attribute));
  assert(!cookie.includes('Domain='));
  const session=env.DB.sqlite.prepare('SELECT * FROM wizard_sessions').get();
  assert.notEqual(session.token_hash,signed.cookie.split('=')[1]);
  assert(!JSON.stringify(signed.payload).includes('password_hash'));
  let response=await call(env,'/api/auth/session',{cookie:signed.cookie});
  assert.equal((await response.json()).csrf,signed.payload.csrf);
  response=await call(env,'/api/save',{cookie:signed.cookie,owner:'owner-B'});
  assert.equal(response.status,401);
  response=await call(env,'/api/auth/register',{method:'POST',body:{name:'Other name',password:PASSWORD}});
  assert.equal(response.status,409);
  response=await call(env,'/api/auth/register',{owner:'owner-B',method:'POST',body:{name:'ČARODEJ PETER',password:PASSWORD}});
  assert.equal(response.status,409);
});

test('Login is generic, rate limited and rotates a valid session; logout requires CSRF and revokes cookie', async t => {
  const env=fixture(t), signed=await register(env);
  let response=await call(env,'/api/auth/login',{method:'POST',cookie:signed.cookie,body:{name:'Čarodej Peter',password:PASSWORD}});
  assert.equal(response.status,403);
  for(let i=0;i<5;i++) {
    response=await call(env,'/api/auth/login',{method:'POST',body:{name:'Čarodej Peter',password:'Nesprávne heslo 123'}});
    assert.equal(response.status,401);
    assert.equal((await response.json()).error.code,'invalid_credentials');
  }
  response=await call(env,'/api/auth/login',{method:'POST',body:{name:'Čarodej Peter',password:PASSWORD}});
  assert.equal(response.status,429);
  env.DB.sqlite.prepare('UPDATE auth_attempts SET window_started_at=?').run(Date.now()-16*60*1000);
  response=await call(env,'/api/auth/login',{method:'POST',cookie:signed.cookie,csrf:signed.payload.csrf,body:{name:'čarodej peter',password:PASSWORD}});
  assert.equal(response.status,200);
  const payload=await response.json(), cookie=response.headers.get('Set-Cookie').split(';')[0];
  assert.notEqual(cookie,signed.cookie);
  assert.notEqual(payload.csrf,signed.payload.csrf);
  assert.equal((await call(env,'/api/save',{cookie:signed.cookie})).status,401);
  assert.equal((await call(env,'/api/auth/logout',{method:'POST',cookie,csrf:signed.payload.csrf,body:{}})).status,403);
  response=await call(env,'/api/auth/logout',{method:'POST',cookie,csrf:payload.csrf,body:{}});
  assert.equal(response.status,200);
  assert.match(response.headers.get('Set-Cookie'),/Max-Age=0/);
  assert.equal((await call(env,'/api/save',{cookie})).status,401);
});

test('Expired sessions and DEV cookie cannot authorize production requests', async t => {
  const env=fixture(t); env.DEV=true;
  const signed=await register(env,'Local wizard',{url:'http://127.0.0.1'});
  assert.match(signed.cookie,/^mo-session=/);
  assert(!signed.response.headers.get('Set-Cookie').includes('Secure'));
  assert.equal((await call(env,'/api/save',{cookie:signed.cookie})).status,401);
  assert.equal((await call(env,'/api/save',{cookie:signed.cookie,url:'http://127.0.0.1'})).status,200);
  env.DB.sqlite.prepare('UPDATE wizard_sessions SET expires_at=0').run();
  assert.equal((await call(env,'/api/save',{cookie:signed.cookie,url:'http://127.0.0.1'})).status,401);
});

test('R2 failure and atomic registration rollback never produce a partial successful account', async t => {
  const env=fixture(t); env.BUCKET.failPut=true;
  let response=await call(env,'/api/auth/register',{method:'POST',body:{name:'Wizard A',password:PASSWORD}});
  assert.equal(response.status,503);
  assert.equal(env.DB.count('wizard_accounts'),0);
  env.DB.failBatchAt=3;
  response=await call(env,'/api/auth/register',{method:'POST',body:{name:'Wizard A',password:PASSWORD}});
  assert.equal(response.status,503);
  for(const table of ['wizard_accounts','wizard_saves','wizard_sessions']) assert.equal(env.DB.count(table),0);
  assert.equal(env.BUCKET.objects.size,0);
  await register(env,'Wizard A');
});

test('Cloud save validates state, requires CSRF and preserves newest revision during concurrent CAS', async t => {
  const env=fixture(t), signed=await register(env), original=signed.payload.save.state;
  const opts={method:'PUT',cookie:signed.cookie,csrf:signed.payload.csrf};
  for(const csrf of ['', '00'.repeat(32)]) assert.equal((await call(env,'/api/save',{...opts,csrf,body:{state:original,expectedRevision:1}})).status,403);
  assert.equal((await call(env,'/api/save',{...opts,body:{state:{version:99},expectedRevision:1}})).status,422);
  const left=JSON.parse(JSON.stringify(original)),right=JSON.parse(JSON.stringify(original));
  left.profile.name='Left wizard';right.profile.name='Right wizard';
  let arrivals=0,release;
  const barrier=new Promise(resolve=>{release=resolve;});
  env.BUCKET.barrier=async()=>{if(++arrivals===2)release();await barrier;};
  const responses=await Promise.all([call(env,'/api/save',{...opts,body:{state:left,expectedRevision:1}}),call(env,'/api/save',{...opts,body:{state:right,expectedRevision:1}})]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  env.BUCKET.barrier=null;
  const cloud=await (await call(env,'/api/save',{cookie:signed.cookie})).json();
  assert.equal(cloud.revision,2);
  assert(['Left wizard','Right wizard'].includes(cloud.state.profile.name));
  assert.equal(env.BUCKET.objects.size,1);
  assert.equal((await call(env,'/api/save',{...opts,body:{state:original,expectedRevision:1}})).status,409);
});

test('An ambiguous database error after CAS commit retains the referenced R2 object for recovery', async t => {
  const env=fixture(t),signed=await register(env);
  const state=signed.payload.save.state;state.profile.name='Recovered wizard';
  env.DB.throwAfterSave=true;
  const response=await call(env,'/api/save',{method:'PUT',cookie:signed.cookie,csrf:signed.payload.csrf,body:{state,expectedRevision:1}});
  assert.equal(response.status,503);
  const cloud=await (await call(env,'/api/save',{cookie:signed.cookie})).json();
  assert.equal(cloud.revision,2);
  assert.equal(cloud.state.profile.name,'Recovered wizard');
  const pointer=env.DB.sqlite.prepare('SELECT object_key FROM wizard_saves').get().object_key;
  assert(env.BUCKET.objects.has(pointer));
});

test('JSON input size is checked while streaming without trusting Content-Length', async () => {
  const req=new Request('https://game.example/api/save',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({large:'x'.repeat(1000)})});
  await assert.rejects(A.readJson(req,64),error=>error.status===413);
  await assert.rejects(A.readJson(new Request('https://game.example',{method:'POST',body:'[]'})),error=>error.status===400);
});

test('Personal local bootstrap requires the explicit development loopback gate', async t => {
  const env = fixture(t);
  const local = { owner: null, url: 'http://127.0.0.1:4175', method: 'POST', body: {} };
  assert.equal((await call(env, '/api/auth/local', local)).status, 404);
  env.MAGNUM_LOCAL_MODE = '1';
  assert.equal((await call(env, '/api/auth/local', local)).status, 403);
  env.DEV = true;
  for (const url of ['https://127.0.0.1:4175', 'http://evil.example', 'http://192.168.0.4:4175']) {
    assert.equal((await call(env, '/api/auth/local', { ...local, url })).status, 403);
  }
  assert.equal(env.DB.count('wizard_accounts'), 0);
  const initial = await (await call(env, '/api/auth/session', { owner: null, url: local.url })).json();
  assert.deepEqual(initial, { account: null, requiresSiteLogin: false, hasAccount: false, localMode: true });
  assert.equal(env.DB.count('wizard_accounts'), 0, 'GET discovery cannot create a profile');
});

test('Personal local creates one session-owned account and ignores forged Sites identity', async t => {
  const env = fixture(t); env.MAGNUM_LOCAL_MODE = '1'; env.DEV = true;
  const local = { owner: 'forged-other-person', url: 'http://127.0.0.1:4175' };
  const response = await call(env, '/api/auth/local', { ...local, method: 'POST', body: {} });
  assert.equal(response.status, 201);
  const payload = await response.json(), cookie = response.headers.get('Set-Cookie').split(';')[0];
  assert.equal(payload.localMode, true);
  assert.equal(payload.account.name, 'AlwaysDisgusted');
  assert.equal(payload.save.state.profile.name, 'AlwaysDisgusted');
  assert.equal(M.balance(payload.save.state), 0);
  assert.match(cookie, /^mo-session=[a-f0-9]{64}$/);
  const account = env.DB.sqlite.prepare('SELECT * FROM wizard_accounts').get();
  assert.equal(account.owner_id, 'magnum-local-personal-v1');
  assert.match(account.password_hash, /^\$scrypt\$/);
  assert(!JSON.stringify(payload).includes(account.password_hash));
  const same = await (await call(env, '/api/auth/session', { ...local, owner: null, cookie })).json();
  assert.equal(same.account.id, payload.account.id);
  assert.equal(same.csrf, payload.csrf);
  assert.equal((await call(env, '/api/auth/register', { ...local, method: 'POST', body: {} })).status, 403);
  assert.equal((await call(env, '/api/auth/login', { ...local, method: 'POST', body: {} })).status, 403);
  assert.equal(env.DB.count('wizard_accounts'), 1);
});

test('Personal local preserves CSRF and save revisions when reopening its profile', async t => {
  const env = fixture(t); env.MAGNUM_LOCAL_MODE = '1'; env.DEV = true;
  const local = { owner: null, url: 'http://127.0.0.1:4175' };
  let response = await call(env, '/api/auth/local', { ...local, method: 'POST', body: {} });
  const payload = await response.json(), cookie = response.headers.get('Set-Cookie').split(';')[0];
  assert.equal((await call(env, '/api/auth/local', { ...local, cookie, method: 'POST', body: {} })).status, 403);
  const state = payload.save.state;
  state.profile.name = 'Môj súkromný čarodej';
  const save = { ...local, cookie, method: 'PUT', body: { state, expectedRevision: 1 } };
  assert.equal((await call(env, '/api/save', save)).status, 403);
  assert.equal((await call(env, '/api/save', { ...save, csrf: payload.csrf })).status, 200);
  assert.equal((await call(env, '/api/save', { ...save, csrf: payload.csrf })).status, 409);
  response = await call(env, '/api/auth/logout', { ...local, cookie, csrf: payload.csrf, method: 'POST', body: {} });
  assert.equal(response.status, 200);
  assert.equal((await call(env, '/api/save', { ...local, cookie })).status, 401);
  response = await call(env, '/api/auth/local', { ...local, method: 'POST', body: {} });
  const reopened = await response.json();
  assert.equal(reopened.account.id, payload.account.id);
  assert.equal(reopened.save.revision, 2);
  assert.equal(reopened.save.state.profile.name, state.profile.name);
  assert.notEqual(reopened.csrf, payload.csrf);
  assert.equal(env.DB.count('wizard_accounts'), 1);
});

test('Personal local rejects cross-origin reads and writes as well as malformed bootstrap requests', async t => {
  const env = fixture(t); env.MAGNUM_LOCAL_MODE = '1'; env.DEV = true;
  const local = { owner: null, url: 'http://127.0.0.1:4175' };
  for (const route of ['/api/auth/session', '/api/auth/local', '/api/save']) {
    const method = route === '/api/auth/local' ? 'POST' : 'GET';
    for (const origin of ['https://evil.example', 'null', 'https://magnum-opus-game-of-life.petojasic.chatgpt.site']) {
      const opts = { ...local, method, headers: { Origin: origin } };
      if (method === 'POST') { opts.body = {}; opts.origin = origin; }
      assert.equal((await call(env, route, opts)).status, 403);
    }
    assert.equal((await call(env, route, { ...local, method, body: method === 'POST' ? {} : undefined, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  }
  assert.equal((await call(env, '/api/auth/local', { ...local, method: 'POST', body: {}, headers: { 'X-MO-Request': '0' } })).status, 403);
  assert.equal((await call(env, '/api/auth/local', { ...local, method: 'POST', body: {}, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal(env.DB.count('wizard_accounts'), 0);
});

test('Personal local concurrent first openings share one folder profile without replacing progress', async t => {
  const env = fixture(t); env.MAGNUM_LOCAL_MODE = '1'; env.DEV = true;
  const opts = { owner: null, url: 'http://127.0.0.1:4175', method: 'POST', body: {} };
  const responses = await Promise.all([call(env, '/api/auth/local', opts), call(env, '/api/auth/local', opts)]);
  const payloads = await Promise.all(responses.map(response => response.json()));
  assert(responses.every(response => response.status === 200 || response.status === 201));
  assert.equal(payloads[0].account.id, payloads[1].account.id);
  assert.equal(payloads[0].save.revision, 1);
  assert.equal(payloads[1].save.revision, 1);
  assert.equal(env.DB.count('wizard_accounts'), 1);
  assert.equal(env.DB.count('wizard_saves'), 1);
  assert.equal(env.BUCKET.objects.size, 1);
});
