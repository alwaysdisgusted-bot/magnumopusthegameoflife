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
const { handleAcademy } = load('academy', { './auth': auth });
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
async function call(env, route, account = 'A', method = 'GET', body, options) { const response = await handleAcademy(request(route, account, method, body, options), env); assert.ok(response); return { status: response.status, body: await response.json() }; }
async function createRoom(env, owner = 'A') { const result = await call(env, '/api/academy/rooms', owner, 'POST', { name: 'Naša akadémia', ownerId: 'C' }); assert.equal(result.status, 201); return result.body; }
async function join(env, code, account = 'B') { return call(env, '/api/academy/rooms/join', account, 'POST', { code }); }
async function createPage(env, roomId = null, account = 'A') { const result = await call(env, '/api/workspace/pages', account, 'POST', { roomId, ownerId: 'C', title: 'Poznámky', body: 'Súkromná myšlienka.' }); assert.equal(result.status, 201); return result.body.page; }

test('personal pages remain private; supplied owner IDs cannot change ownership; revisions prevent lost updates', async t => {
  const env = fixture(t); const page = await createPage(env);
  assert.equal(page.ownerId, 'A');
  assert.deepEqual((await call(env, '/api/workspace/pages', 'B')).body.pages, []);
  for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await call(env, '/api/workspace/pages/' + page.id, 'B', method, method === 'GET' ? undefined : { title: 'Stolen', body: '', expectedRevision: 1 })).status, 404);
  const updated = await call(env, '/api/workspace/pages/' + page.id, 'A', 'PUT', { title: 'Moje poznámky', body: 'Nová verzia.', expectedRevision: 1 });
  assert.equal(updated.status, 200); assert.equal(updated.body.page.revision, 2);
  assert.equal((await call(env, '/api/workspace/pages/' + page.id, 'A', 'PUT', { title: 'Old', body: '', expectedRevision: 1 })).status, 409);
  assert.equal((await call(env, '/api/workspace/pages/' + page.id, 'A', 'DELETE', { expectedRevision: 1 })).status, 409);
  assert.equal((await call(env, '/api/workspace/pages/' + page.id)).body.page.body, 'Nová verzia.');
  assert.equal((await call(env, '/api/workspace/pages/' + page.id, 'A', 'DELETE', { expectedRevision: 2 })).status, 200);
});

test('shared records are visible and editable only to members; joining never exposes personal records', async t => {
  const env = fixture(t); const personal = await createPage(env); const created = await createRoom(env); const id = created.room.id;
  assert.equal(created.room.ownerId, 'A'); assert.match(created.inviteCode, /^[A-Z2-9]{16}$/);
  const stored = env.DB.sqlite.prepare('SELECT invite_hash FROM academy_rooms WHERE id = ?').get(id);
  assert.equal(stored.invite_hash.length, 64); assert.notEqual(stored.invite_hash, created.inviteCode);
  assert.equal((await call(env, '/api/academy/rooms/' + id + '/channels', 'B')).status, 404);
  assert.equal((await join(env, created.inviteCode)).status, 200);
  const channels = (await call(env, '/api/academy/rooms/' + id + '/channels', 'B')).body.channels;
  assert.equal(channels[0].name, 'všeobecne');
  const shared = await createPage(env, id);
  const listing = await call(env, '/api/workspace/pages?roomId=' + id, 'B'); assert.equal(listing.body.pages.length, 1); assert.equal(listing.body.pages[0].id, shared.id);
  assert.equal((await call(env, '/api/workspace/pages/' + personal.id, 'B')).status, 404);
  assert.equal((await call(env, '/api/workspace/pages?roomId=' + id, 'C')).status, 404);
  assert.equal((await call(env, '/api/workspace/pages', 'B')).body.pages.length, 0);
  const edit = await call(env, '/api/workspace/pages/' + shared.id, 'B', 'PUT', { expectedRevision: 1, title: 'Spoločné', body: 'Príspevok člena.' }); assert.equal(edit.status, 200);
  assert.equal((await call(env, '/api/workspace/pages/' + shared.id, 'C', 'DELETE', { expectedRevision: 2 })).status, 404);
  assert.equal((await call(env, '/api/workspace/pages/' + shared.id, 'A', 'PUT', { expectedRevision: 1, title: 'Stará verzia', body: '' })).status, 409);
});

test('task assignees must belong to the same room and status updates use optimistic concurrency', async t => {
  const env = fixture(t), created = await createRoom(env); await join(env, created.inviteCode);
  const data = { title: 'Spoločný projekt', description: 'Prvý krok', roomId: created.room.id, status: 'todo', assigneeId: 'B' };
  const result = await call(env, '/api/workspace/tasks', 'A', 'POST', data); assert.equal(result.status, 201); const task = result.body.task;
  assert.equal((await call(env, '/api/workspace/tasks', 'A', 'POST', { ...data, assigneeId: 'C' })).status, 400);
  assert.equal((await call(env, '/api/workspace/tasks', 'A', 'POST', { ...data, roomId: null, assigneeId: 'B' })).status, 400);
  assert.equal((await call(env, '/api/workspace/tasks/' + task.id, 'C', 'PUT', { ...data, expectedRevision: 1 })).status, 404);
  const moving = await call(env, '/api/workspace/tasks/' + task.id, 'B', 'PUT', { ...data, status: 'doing', expectedRevision: 1, roomId: null, ownerId: 'C' });
  assert.equal(moving.status, 200); assert.equal(moving.body.task.roomId, created.room.id); assert.equal(moving.body.task.ownerId, 'A');
  assert.equal((await call(env, '/api/workspace/tasks/' + task.id, 'A', 'PUT', { ...data, status: 'done', expectedRevision: 1 })).status, 409);
  assert.equal((await call(env, '/api/workspace/tasks/' + task.id, 'B', 'DELETE', { expectedRevision: 2 })).status, 200);
});

test('channels and plaintext messages enforce membership and author identity; history is paginated', async t => {
  const env = fixture(t), created = await createRoom(env); await join(env, created.inviteCode);
  const channelResult = await call(env, '/api/academy/rooms/' + created.room.id + '/channels', 'B', 'POST', { name: 'projekty' }); assert.equal(channelResult.status, 201); const id = channelResult.body.channel.id;
  const route = '/api/academy/channels/' + id + '/messages';
  assert.equal((await call(env, route, 'C')).status, 404);
  assert.equal((await call(env, route, 'C', 'POST', { body: 'Unwanted' })).status, 404);
  const content = '<script>alert("len text")</script>\nSlovenská správa.';
  const message = await call(env, route, 'B', 'POST', { authorId: 'A', body: content }); assert.equal(message.status, 201); assert.equal(message.body.message.authorId, 'B'); assert.equal(message.body.message.body, content);
  assert.equal((await call(env, route, 'B', 'POST', { body: 'x'.repeat(4001) })).status, 400);
  for (let n = 0; n < 105; n++) env.DB.sqlite.prepare('INSERT INTO academy_messages (id, channel_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run('history-' + String(n).padStart(3, '0'), id, 'A', 'Záznam ' + n, new Date(Date.UTC(2020, 0, 1, 0, n)).toISOString());
  const latest = await call(env, route, 'A'); assert.equal(latest.body.messages.length, 100); assert.equal(latest.body.hasMore, true);
  const older = await call(env, route + '?before=' + latest.body.messages[0].id, 'B'); assert.equal(older.body.messages.length, 6); assert.equal(older.body.hasMore, false);
  assert.equal(new Set(latest.body.messages.concat(older.body.messages).map(m => m.id)).size, 106);
});

test('only the room owner can rotate codes; revoked codes fail and current members remain', async t => {
  const env = fixture(t), created = await createRoom(env); await join(env, created.inviteCode);
  const route = '/api/academy/rooms/' + created.room.id + '/invite';
  assert.equal((await call(env, route, 'B', 'POST', {})).status, 403);
  const rotated = await call(env, route, 'A', 'POST', {}); assert.equal(rotated.status, 200); assert.notEqual(rotated.body.inviteCode, created.inviteCode);
  assert.equal((await join(env, created.inviteCode, 'C')).status, 404);
  assert.equal((await join(env, rotated.body.inviteCode, 'C')).status, 200);
  const members = await call(env, '/api/academy/rooms/' + created.room.id + '/members', 'B'); assert.deepEqual(members.body.members.map(m => m.id).sort(), ['A', 'B', 'C']);
  assert.deepEqual(members.body.members.map(m => m.name).sort(), ['Čarodej A', 'Čarodej B', 'Čarodej C']);
});

test('invitation guessing is rate limited atomically and authentication/CSRF are mandatory', async t => {
  const env = fixture(t), created = await createRoom(env);
  for (let n = 0; n < 12; n++) assert.equal((await join(env, 'AAAAAAAAAAAAAAAA', 'C')).status, 404);
  assert.equal((await join(env, created.inviteCode, 'C')).status, 429);
  env.DB.sqlite.prepare('UPDATE academy_join_attempts SET window_start = 0 WHERE account_id = ?').run('C');
  assert.equal((await join(env, created.inviteCode, 'C')).status, 200);
  assert.equal((await call(env, '/api/academy/rooms', 'A', 'GET', undefined, { noSession: true })).status, 401);
  for (const route of ['/api/academy/rooms', '/api/workspace/pages', '/api/workspace/tasks']) assert.equal((await call(env, route, 'A', 'POST', {}, { noCsrf: true })).status, 403);
  assert.equal((await call(env, '/api/workspace/pages', 'A', 'POST', { title: 'X', body: '' }, { origin: 'https://attacker.example' })).status, 403);
});

test('concurrent shared-page writers cannot overwrite each other', async t => {
  const env = fixture(t), created = await createRoom(env); await join(env, created.inviteCode); const page = await createPage(env, created.room.id);
  const results = await Promise.all(['A', 'B'].map(id => call(env, '/api/workspace/pages/' + page.id, id, 'PUT', { title: 'Verzia ' + id, body: id, expectedRevision: 1 })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal((await call(env, '/api/workspace/pages/' + page.id)).body.page.revision, 2);
});
