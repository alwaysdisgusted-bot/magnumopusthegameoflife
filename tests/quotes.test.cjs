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
  const loaded = new Module(filename, module); loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = loaded.require.bind(loaded); loaded.require = id => dependencies[id] || original(id);
  loaded._compile(compiled.outputText, filename); return loaded.exports;
}
const auth = load('auth');
const { handleQuotes } = load('quotes', { './auth': auth });
const hash = value => createHash('sha256').update(value).digest('hex');
class Statement {
  constructor(db, sql, values = []) { this.db = db; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.db, this.sql, values); }
  async first() { return this.db.sqlite.prepare(this.sql).get(...this.values) || null; }
  async all() { return { results: this.db.sqlite.prepare(this.sql).all(...this.values), success: true }; }
  execute() { const result = this.db.sqlite.prepare(this.sql).run(...this.values); return { success: true, results: [], meta: { changes: Number(result.changes) } }; }
  async run() { return this.execute(); }
}
class TestD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:'); this.sqlite.exec('PRAGMA foreign_keys=ON');
    const folder = path.resolve(__dirname, '../drizzle');
    fs.readdirSync(folder).filter(name => name.endsWith('.sql')).sort().forEach(name => this.sqlite.exec(fs.readFileSync(path.join(folder, name), 'utf8')));
    assert.ok(this.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'academy_rooms'").get(), 'Generate the academy migration before running these integration tests.');
  }
  prepare(sql) { return new Statement(this, sql); }
  async batch(statements) { this.sqlite.exec('BEGIN IMMEDIATE'); try { const result = statements.map(s => s.execute()); this.sqlite.exec('COMMIT'); return result; } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; } }
}
function fixture(t) {
  const env = { DB: new TestD1(), BUCKET: {} }; t.after(() => env.DB.sqlite.close());
  for (const id of ['A', 'B', 'C']) {
    env.DB.sqlite.prepare('INSERT INTO wizard_accounts (id, owner_id, normalized_name, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, 'owner-' + id, 'wizard-' + id, 'Čarodej ' + id, 'not-used-by-session-tests', Date.now());
    env.DB.sqlite.prepare('INSERT INTO wizard_sessions (token_hash, account_id, owner_id, csrf_value, expires_at) VALUES (?, ?, ?, ?, ?)').run(hash(hash('session-' + id)), id, 'owner-' + id, hash('csrf-' + id), Date.now() + 86400000);
  }
  return env;
}
function request(route, account = 'A', method = 'GET', body, options = {}) {
  const headers = { 'oai-authenticated-user-id': 'owner-' + account, Cookie: '__Host-mo-session=' + hash('session-' + account) };
  if (method !== 'GET') Object.assign(headers, { Origin: options.origin || 'https://game.example', 'Content-Type': 'application/json', 'X-MO-Request': '1', 'X-MO-CSRF': options.noCsrf ? '' : hash('csrf-' + account) });
  if (options.noSession) delete headers.Cookie;
  return new Request('https://game.example' + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function call(env, route, account = 'A', method = 'GET', body, options) { let response; try { response = await handleQuotes(request(route, account, method, body, options), env); } catch(e) { response=auth.json({error:{code:e.code,message:e.message}},e.status); } assert.ok(response); return { status: response.status, body: await response.json() }; }

test('quote collection and preferences are isolated by session owner and survive repeated saves', async t => {
  const env=fixture(t);
  assert.deepEqual((await call(env,'/api/quotes/settings')).body,{enabled:true,idleMinutes:5});
  assert.equal((await call(env,'/api/quotes/settings','A','PUT',{enabled:false,idleMinutes:10,accountId:'B'})).status,200);
  assert.deepEqual((await call(env,'/api/quotes/settings','B')).body,{enabled:true,idleMinutes:5});
  for(let i=0;i<2;i++)assert.equal((await call(env,'/api/quotes/saved','A','POST',{quoteId:'scan-15',accountId:'B'})).status,200);
  assert.equal((await call(env,'/api/quotes/saved','A')).body.saved.length,1);
  assert.deepEqual((await call(env,'/api/quotes/saved','B')).body.saved,[]);
  assert.equal((await call(env,'/api/quotes/saved','B','DELETE',{quoteId:'scan-15'})).status,200);
  assert.equal((await call(env,'/api/quotes/saved','A')).body.saved.length,1);
});
test('quote endpoints reject unauthenticated writes, CSRF, forged origins and unknown catalog ids', async t => {
  const env=fixture(t);
  assert.equal((await call(env,'/api/quotes/saved','A','POST',{quoteId:'text-1'},{noSession:true})).status,401);
  assert.equal((await call(env,'/api/quotes/saved','A','POST',{quoteId:'text-1'},{noCsrf:true})).status,403);
  assert.equal((await call(env,'/api/quotes/saved','A','POST',{quoteId:'text-1'},{origin:'https://other.example'})).status,403);
  assert.equal((await call(env,'/api/quotes/saved','A','POST',{quoteId:'evil-id'})).status,422);
  assert.equal((await call(env,'/api/quotes/saved','A','POST',{quoteId:'classic-24'})).status,200);
  assert.equal((await call(env,'/api/quotes/saved','A','POST',{quoteId:'classic-25'})).status,422);
  assert.equal((await call(env,'/api/quotes/settings','A','PUT',{enabled:'false',idleMinutes:0})).status,422);
});
