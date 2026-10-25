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
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = loaded.require.bind(loaded);
  loaded.require = id => dependencies[id] || original(id);
  loaded._compile(compiled.outputText, filename);
  return loaded.exports;
}
const auth = load('auth');
const { handleDesk } = load('desk', { './auth': auth });
const M = require('../server/desk-model.mjs').default;
const hash = value => createHash('sha256').update(value).digest('hex');

class Statement {
  constructor(db, sql, values = []) { this.db = db; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.db, this.sql, values); }
  async first() {
    if (this.db.failReferenceRead && this.sql.startsWith('SELECT account_id FROM alchemy_desks')) throw new Error('Reference read unavailable');
    return this.db.sqlite.prepare(this.sql).get(...this.values) || null;
  }
  async run() {
    const isMutation = /^(?:UPDATE|INSERT INTO) alchemy_desks/.test(this.sql);
    if (isMutation && this.db.failBeforeWrite) { this.db.failBeforeWrite = false; throw new Error('Write unavailable'); }
    const result = this.db.sqlite.prepare(this.sql).run(...this.values);
    if (isMutation && this.db.failAfterWrite) { this.db.failAfterWrite = false; throw new Error('Transport failed after commit'); }
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }
}
class TestD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys=ON');
    const folder = path.resolve(__dirname, '../drizzle');
    for (const name of fs.readdirSync(folder).filter(name => name.endsWith('.sql')).sort()) this.sqlite.exec(fs.readFileSync(path.join(folder, name), 'utf8'));
    assert.ok(this.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='alchemy_desks'").get(), 'Generate the alchemy_desks migration before these integration tests.');
  }
  prepare(sql) { return new Statement(this, sql); }
}
class TestBucket {
  objects = new Map();
  deleted = [];
  async put(key, contents) {
    if (this.failPut) { this.failPut = false; throw new Error('R2 unavailable'); }
    if (this.nullPut) { this.nullPut = false; return null; }
    this.objects.set(key, contents);
    if (this.barrier) await this.barrier();
    return { key };
  }
  async get(key) {
    if (this.beforeGet) await this.beforeGet(key);
    if (this.failGet) throw new Error('R2 unavailable');
    const contents = this.objects.get(key);
    return contents === undefined ? null : { size: Buffer.byteLength(contents), text: async () => contents };
  }
  async delete(key) { this.deleted.push(key); this.objects.delete(key); }
}
function fixture(t) {
  const env = { DB: new TestD1(), BUCKET: new TestBucket() };
  t.after(() => env.DB.sqlite.close());
  for (const id of ['A', 'B']) {
    env.DB.sqlite.prepare('INSERT INTO wizard_accounts(id,owner_id,normalized_name,display_name,password_hash,created_at) VALUES(?,?,?,?,?,?)').run(id, 'owner-' + id, 'wizard-' + id, 'Čarodej ' + id, 'not-used', Date.now());
    env.DB.sqlite.prepare('INSERT INTO wizard_sessions(token_hash,account_id,owner_id,csrf_value,expires_at) VALUES(?,?,?,?,?)').run(hash(hash('session-' + id)), id, 'owner-' + id, hash('csrf-' + id), Date.now() + 86400000);
  }
  return env;
}
function request(options = {}) {
  const { account = 'A', method = 'GET', body, route = '/api/desk', origin = 'https://game.example', noCsrf, noSession, noOwner, owner, header = '1' } = options;
  const headers = { 'oai-authenticated-user-id': owner ?? ('owner-' + account), Cookie: '__Host-mo-session=' + hash('session-' + account) };
  if (noSession) delete headers.Cookie;
  if (noOwner) delete headers['oai-authenticated-user-id'];
  if (method !== 'GET') Object.assign(headers, { Origin: origin, 'Content-Type': 'application/json', 'X-MO-Request': header, 'X-MO-CSRF': noCsrf ? '' : hash('csrf-' + account) });
  return new Request('https://game.example' + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function call(env, options = {}) {
  const response = await handleDesk(request(options), env);
  assert.ok(response);
  return { status: response.status, headers: response.headers, body: await response.json() };
}
function desk(label) {
  const state = M.createState();
  state.items.push({ id: 'note-1', type: 'note', x: 10, y: 10, width: 220, height: 180, z: 1, color: '#fff199', text: label });
  return state;
}
function put(env, state, expectedRevision = 0, options = {}) { return call(env, { method: 'PUT', body: { state, expectedRevision }, ...options }); }
function pointer(env, account = 'A') { return env.DB.sqlite.prepare('SELECT * FROM alchemy_desks WHERE account_id=?').get(account); }

test('additional canvases round-trip through the same private revision without changing the primary desk', async t => {
  const env = fixture(t), original = desk('Primary');
  original.canvases = [{ id: 'canvas-one', name: 'New', state: desk('Separate') }];
  assert.equal((await put(env, original)).status, 200);
  assert.deepEqual((await call(env)).body.state, original);
  assert.equal((await call(env, { account: 'B' })).body.state.canvases, undefined);
  const invalid = structuredClone(original);
  invalid.canvases[0].state.canvases = [];
  assert.equal((await put(env, invalid, 1)).status, 422);
  assert.deepEqual((await call(env)).body.state, original);
  original.canvases[0].state.items[0].text = 'Changed second only';
  assert.equal((await put(env, original, 1)).status, 200);
  assert.equal((await put(env, original, 1)).status, 409);
  assert.equal((await call(env)).body.state.items[0].text, 'Primary');
});

test('a new account has an empty private desk; caller-supplied account IDs never change ownership', async t => {
  const env = fixture(t);
  const empty = await call(env);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, { state: M.createState(), revision: 0, updatedAt: null });
  assert.match(empty.headers.get('Cache-Control'), /no-store/);
  const state = desk('Moja súkromná poznámka');
  const saved = await call(env, { method: 'PUT', body: { state, expectedRevision: 0, accountId: 'B', ownerId: 'owner-B' } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.revision, 1);
  assert.equal(typeof saved.body.updatedAt, 'number');
  assert.equal(pointer(env, 'B'), undefined);
  assert.deepEqual((await call(env, { account: 'B', route: '/api/desk?accountId=A' })).body.state, M.createState());
  assert.deepEqual((await call(env)).body.state, state);
  assert.match(pointer(env).object_key, /^desks\/A\/[a-f0-9-]+\.json$/);
});

test('trusted Site identity, account session, CSRF and same-origin JSON writes are mandatory', async t => {
  const env = fixture(t), state = desk('Bezpečne');
  for (const options of [{ noSession: true }, { noOwner: true }, { owner: 'owner-B' }]) {
    assert.equal((await call(env, options)).status, 401);
    assert.equal((await put(env, state, 0, options)).status, 401);
  }
  for (const options of [{ noCsrf: true }, { origin: 'https://attacker.example' }, { header: '0' }]) assert.equal((await put(env, state, 0, options)).status, 403);
  assert.equal(pointer(env), undefined);
  assert.equal((await call(env, { method: 'POST', body: {} })).status, 405);
  assert.equal(await handleDesk(request({ route: '/api/elsewhere' }), env), null);
});

test('invalid desk data and revisions preserve the existing pointer and object', async t => {
  const env = fixture(t), original = desk('Pôvodné');
  assert.equal((await put(env, original)).status, 200);
  const previous = pointer(env);
  for (const revision of [-1, 0.5, '1', null, Number.MAX_SAFE_INTEGER]) assert.equal((await put(env, original, revision)).status, 422);
  for (const state of [{ version: 999 }, { ...original, ownerId: 'B' }, { ...original, items: [{ ...original.items[0], text: 'x'.repeat(5001) }] }]) assert.equal((await put(env, state, 1)).status, 422);
  assert.deepEqual(pointer(env), previous);
  assert.equal(env.BUCKET.objects.size, 1);
  assert.deepEqual((await call(env)).body.state, original);
});

test('concurrent initial inserts and subsequent updates each accept exactly one writer', async t => {
  const env = fixture(t);
  for (const expectedRevision of [0, 1]) {
    let arrivals = 0, release;
    const waiting = new Promise(resolve => { release = resolve; });
    env.BUCKET.barrier = async () => { if (++arrivals === 2) release(); await waiting; };
    const results = await Promise.all([put(env, desk('ľavá ' + expectedRevision), expectedRevision), put(env, desk('pravá ' + expectedRevision), expectedRevision)]);
    env.BUCKET.barrier = null;
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    assert.equal(pointer(env).revision, expectedRevision + 1);
    assert.equal(env.BUCKET.objects.size, 1);
  }
  const current = await call(env);
  assert.equal(current.body.revision, 2);
  assert.equal((await put(env, desk('Stará verzia'), 1)).status, 409);
  assert.equal((await put(env, desk('Starý prvý zápis'), 0)).status, 409);
  assert.deepEqual((await call(env)).body, current.body);
});

test('R2 failures and pre-commit database failures keep the old desk usable', async t => {
  const env = fixture(t), original = desk('Pôvodné');
  await put(env, original);
  const previous = pointer(env);
  for (const flag of ['failPut', 'nullPut']) {
    env.BUCKET[flag] = true;
    assert.equal((await put(env, desk('Neuložené'), 1)).status, 503);
    assert.deepEqual(pointer(env), previous);
  }
  env.DB.failBeforeWrite = true;
  assert.equal((await put(env, desk('Neuložené v D1'), 1)).status, 503);
  assert.equal(env.BUCKET.objects.size, 1);
  assert.deepEqual((await call(env)).body.state, original);
});

test('ambiguous transport failures after insert and update retain the committed R2 blob', async t => {
  const env = fixture(t);
  for (const revision of [0, 1]) {
    env.DB.failAfterWrite = true;
    const state = desk('Obnovené ' + revision);
    assert.equal((await put(env, state, revision)).status, 503);
    const current = await call(env);
    assert.equal(current.status, 200);
    assert.equal(current.body.revision, revision + 1);
    assert.deepEqual(current.body.state, state);
    assert.ok(env.BUCKET.objects.has(pointer(env).object_key));
  }
});

test('cleanup retains an orphan when the reference check is unavailable', async t => {
  const env = fixture(t);
  env.DB.failBeforeWrite = true;
  env.DB.failReferenceRead = true;
  assert.equal((await put(env, desk('Neistý zápis'))).status, 503);
  assert.equal(pointer(env), undefined);
  assert.equal(env.BUCKET.objects.size, 1);
  assert.equal(env.BUCKET.deleted.length, 0);
});

test('GET retries a stale pointer and reports unavailable storage without fabricating an empty desk', async t => {
  const env = fixture(t);
  await put(env, desk('Prvá verzia'));
  const oldKey = pointer(env).object_key;
  env.BUCKET.beforeGet = async key => {
    if (key !== oldKey) return;
    env.BUCKET.beforeGet = null;
    assert.equal((await put(env, desk('Nová verzia'), 1)).status, 200);
  };
  const loaded = await call(env);
  assert.equal(loaded.status, 200);
  assert.equal(loaded.body.revision, 2);
  assert.equal(loaded.body.state.items[0].text, 'Nová verzia');
  env.BUCKET.objects.delete(pointer(env).object_key);
  assert.equal((await call(env)).status, 503);
  env.BUCKET.objects.set(pointer(env).object_key, '{broken');
  assert.equal((await call(env)).status, 503);
});

test('streaming body limits reject oversized requests before creating a blob', async t => {
  const env = fixture(t);
  const response = await put(env, { huge: 'x'.repeat(10 * 1024 * 1024 + 1024) });
  assert.equal(response.status, 413);
  assert.equal(env.BUCKET.objects.size, 0);
});

test('legacy snapshots normalize to a disabled grid and custom grids round-trip privately with CAS',async t=>{
  const env=fixture(t),legacy=desk('Pôvodná kresba');delete legacy.grid;
  assert.equal((await put(env,legacy)).status,200);
  const first=await call(env);assert.deepEqual(first.body.state.grid,M.createState().grid);assert.equal(first.body.revision,1);
  const custom=first.body.state;custom.grid={enabled:true,spacing:35,style:'lines',color:'#4058A6',opacity:.4};
  assert.equal((await put(env,custom,1)).status,200);assert.deepEqual((await call(env)).body.state.grid,custom.grid);
  assert.equal((await call(env,{account:'B'})).body.state.grid.enabled,false);
  const before=pointer(env);assert.equal((await put(env,{...custom,grid:{...custom.grid,spacing:101}},2)).status,422);assert.deepEqual(pointer(env),before);
  const stored=JSON.parse(env.BUCKET.objects.get(before.object_key));delete stored.grid;env.BUCKET.objects.set(before.object_key,JSON.stringify(stored));
  const oldBlob=await call(env);assert.equal(oldBlob.body.revision,2);assert.equal(oldBlob.body.state.grid.enabled,false);assert.deepEqual(pointer(env),before);
});
