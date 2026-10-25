/* eslint-disable @typescript-eslint/no-require-imports -- This Node .cjs integration harness intentionally uses CommonJS. */
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
  loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = loaded.require.bind(loaded);
  loaded.require = id => dependencies[id] || original(id);
  loaded._compile(compiled.outputText, filename);
  return loaded.exports;
}
const auth = load('auth');
const { handleSocial } = load('social', { './auth': auth });
const hash = value => createHash('sha256').update(value).digest('hex');
class Statement {
  constructor(db, sql, values = []) { this.db = db; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.db, this.sql, values); }
  async first(column) { const row = this.db.sqlite.prepare(this.sql).get(...this.values); return row ? (column === undefined ? row : row[column]) : null; }
  async all() { return { success: true, results: this.db.sqlite.prepare(this.sql).all(...this.values) }; }
  async run() { const result = this.db.sqlite.prepare(this.sql).run(...this.values); return { success: true, results: [], meta: { changes: Number(result.changes) } }; }
}
class TestD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys=ON');
    const folder = path.resolve(__dirname, '../drizzle');
    for (const name of fs.readdirSync(folder).filter(name => name.endsWith('.sql')).sort()) this.sqlite.exec(fs.readFileSync(path.join(folder, name), 'utf8'));
    for (const table of ['social_profiles', 'social_friendships', 'social_mail']) assert.ok(this.sqlite.prepare('SELECT name FROM sqlite_master WHERE name=?').get(table), 'Generate the social migration before running integration tests.');
  }
  prepare(sql) { return new Statement(this, sql); }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.all()); this.sqlite.exec('COMMIT'); return results; }
    catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
}
function addAccount(env, id) {
  env.DB.sqlite.prepare('INSERT INTO wizard_accounts(id,owner_id,normalized_name,display_name,password_hash,created_at) VALUES(?,?,?,?,?,?)').run(id, 'owner-' + id, auth.normalizeName('Čarodej ' + id).normalized, 'Čarodej ' + id, 'unused', Date.now());
}
function fixture(t) {
  const env = { DB: new TestD1(), BUCKET: {} };
  t.after(() => env.DB.sqlite.close());
  for (const id of ['A', 'B', 'C']) {
    addAccount(env, id);
    env.DB.sqlite.prepare('INSERT INTO wizard_sessions(token_hash,account_id,owner_id,csrf_value,expires_at) VALUES(?,?,?,?,?)').run(hash(hash('session-' + id)), id, 'owner-' + id, hash('csrf-' + id), Date.now() + 86400000);
  }
  return env;
}
const PROFILE = '/api/social/profile', HALL = '/api/social/hall', FRIENDS = '/api/social/friends', MAIL = '/api/social/mail';
function request(options = {}) {
  const { account = 'A', route = PROFILE, method = 'GET', body, rawBody, noSession, noOwner, owner, noCsrf, origin = 'https://game.example', header = '1', contentType = 'application/json' } = options;
  const headers = { 'oai-authenticated-user-id': owner ?? ('owner-' + account), Cookie: '__Host-mo-session=' + hash('session-' + account) };
  if (noSession) delete headers.Cookie;
  if (noOwner) delete headers['oai-authenticated-user-id'];
  if (method !== 'GET') Object.assign(headers, { Origin: origin, 'Content-Type': contentType, 'X-MO-Request': header, 'X-MO-CSRF': noCsrf ? '' : hash('csrf-' + account) });
  return new Request('https://game.example' + route, { method, headers, body: rawBody === undefined ? (body === undefined ? undefined : JSON.stringify(body)) : rawBody });
}
async function call(env, options = {}) {
  const response = await handleSocial(request(options), env);
  assert.ok(response, 'Social handler must handle ' + (options.route || PROFILE));
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function profile(env, account, overrides = {}) {
  const result = await call(env, { account, route: PROFILE, method: 'PUT', body: { visible: true, bio: 'Príbeh ' + account, expectedRevision: 0, ...overrides } });
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.profile;
}
async function friendRequest(env, account = 'A', target = 'B') {
  const result = await call(env, { account, route: FRIENDS + '/request', method: 'POST', body: { accountId: target } });
  assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body.friendship;
}
async function accept(env, friendship, account = 'B') {
  const result = await call(env, { account, route: FRIENDS + '/' + friendship.id + '/respond', method: 'POST', body: { accept: true } });
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.friendship;
}
async function befriend(env, account = 'A', target = 'B') {
  await profile(env, target);
  return accept(env, await friendRequest(env, account, target), target);
}
async function send(env, overrides = {}, account = 'A') {
  const result = await call(env, { account, route: MAIL, method: 'POST', body: { recipientId: 'B', subject: 'Pozdrav', text: 'Ahoj, ako sa darí?', ...overrides } });
  assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body.message;
}

test('social reads require the trusted site identity and wizard session; every write requires same-origin JSON and CSRF', async t => {
  const env = fixture(t);
  await profile(env, 'B');
  const friendship = await friendRequest(env);
  const accepted = await accept(env, friendship);
  const message = await send(env);
  const reads = [PROFILE, HALL, FRIENDS, MAIL + '?box=inbox', MAIL + '/' + message.id];
  for (const route of reads) {
    for (const options of [{ noOwner: true }, { noSession: true }, { owner: 'owner-B' }]) assert.equal((await call(env, { route, ...options })).status, 401, route);
    assert.match((await call(env, { route })).headers.get('Cache-Control'), /no-store/);
  }
  const writes = [
    { route: PROFILE, method: 'PUT', body: { visible: true, bio: '', expectedRevision: 0 } },
    { route: FRIENDS + '/request', method: 'POST', body: { accountId: 'B' } },
    { account: 'B', route: FRIENDS + '/' + accepted.id + '/respond', method: 'POST', body: { accept: true } },
    { route: FRIENDS + '/' + accepted.id, method: 'DELETE', body: {} },
    { route: MAIL, method: 'POST', body: { recipientId: 'B', subject: 'Pozdrav', text: 'Text' } },
    { account: 'B', route: MAIL + '/' + message.id + '/read', method: 'POST', body: {} },
  ];
  for (const write of writes) {
    for (const options of [{ noOwner: true }, { noSession: true }, { owner: 'owner-C' }]) assert.equal((await call(env, { ...write, ...options })).status, 401, write.route);
    for (const options of [{ noCsrf: true }, { origin: 'https://attacker.example' }, { header: '0' }]) assert.equal((await call(env, { ...write, ...options })).status, 403, write.route);
    assert.equal((await call(env, { ...write, contentType: 'text/plain' })).status, 415, write.route);
    assert.equal((await call(env, { ...write, rawBody: '{invalid' })).status, 400, write.route);
  }
  for (const route of ['/api/profile', '/api/sociality', '/api/mailbox']) assert.equal(await handleSocial(request({ route }), env), null);
});

test('profiles start private and revisioned updates control the public hall without exposing private account fields', async t => {
  const env = fixture(t);
  assert.deepEqual((await call(env)).body.profile, { accountId: 'A', displayName: 'Čarodej A', visible: false, bio: '', revision: 0, updatedAt: null });
  assert.deepEqual((await call(env, { route: HALL })).body.wizards, []);
  const own = await profile(env, 'A', { accountId: 'B', ownerId: 'owner-B', displayName: 'Podvrh', bio: '<b>Príbeh A</b>' });
  assert.equal(own.accountId, 'A'); assert.equal(own.displayName, 'Čarodej A'); assert.equal(own.revision, 1); assert.equal(typeof own.updatedAt, 'number');
  await profile(env, 'B'); await profile(env, 'C', { visible: false, bio: 'Tajný príbeh C' });
  const hall = await call(env, { route: HALL });
  assert.deepEqual(hall.body, { wizards: [{ accountId: 'B', displayName: 'Čarodej B', bio: 'Príbeh B' }], truncated: false });
  assert.deepEqual((await call(env, { route: HALL + '?q=' + encodeURIComponent('Čarodej B') })).body.wizards, hall.body.wizards);
  assert.deepEqual((await call(env, { route: HALL + '?q=nikto' })).body.wizards, []);
  assert.deepEqual((await call(env, { account: 'B' })).body.profile.bio, 'Príbeh B');
  const updates = await Promise.all(['Úprava 1', 'Úprava 2'].map(bio => call(env, { route: PROFILE, method: 'PUT', body: { visible: false, bio, expectedRevision: 1 } })));
  assert.deepEqual(updates.map(r => r.status).sort(), [200, 409]);
  const latest = (await call(env)).body.profile;
  assert.equal(latest.revision, 2); assert.equal(latest.visible, false);
  assert.deepEqual((await call(env, { account: 'B', route: HALL })).body.wizards, []);
  for (const body of [{ visible: 1, bio: '' }, { visible: 'true', bio: '' }, { visible: true, bio: 12 }, { visible: true, bio: 'x'.repeat(161) }, { visible: true, bio: '\u0000' }, { visible: true, bio: '', expectedRevision: -1 }, { visible: true, bio: '', expectedRevision: '2' }]) assert.equal((await call(env, { route: PROFILE, method: 'PUT', body })).status, 422);
  for (const query of ['?limit=0', '?limit=-1', '?limit=1.5', '?limit=nope']) assert.equal((await call(env, { route: HALL + query })).status, 400);
});

test('first profile creation and hall pagination preserve revision checks and visibility', async t => {
  const env = fixture(t);
  const creates = await Promise.all(['Prvá', 'Druhá'].map(bio => call(env, { method: 'PUT', body: { visible: true, bio, expectedRevision: 0 } })));
  assert.deepEqual(creates.map(r => r.status).sort(), [200, 409]);
  assert.equal((await call(env)).body.profile.revision, 1);
  const firstWithoutRevision = await call(env, { account: 'B', method: 'PUT', body: { visible: true, bio: 'x'.repeat(160) } });
  assert.equal(firstWithoutRevision.status, 200); assert.equal(firstWithoutRevision.body.profile.revision, 1);
  await profile(env, 'C');
  const limited = await call(env, { route: HALL + '?limit=1' });
  assert.equal(limited.body.wizards.length, 1); assert.equal(limited.body.truncated, true);
  assert.equal((await call(env, { route: HALL + '?limit=2' })).body.truncated, false);
});

test('friend requests stay pending when repeated or reciprocal and only their recipient can accept', async t => {
  const env = fixture(t);
  await profile(env, 'A'); await profile(env, 'B');
  const friendship = await friendRequest(env);
  for (const [account, target] of [['A', 'B'], ['B', 'A']]) {
    const duplicate = await call(env, { account, route: FRIENDS + '/request', method: 'POST', body: { accountId: target } });
    assert.equal(duplicate.status, 200); assert.equal(duplicate.body.friendship.id, friendship.id); assert.equal(duplicate.body.friendship.status, 'pending');
  }
  const outgoing = (await call(env, { route: FRIENDS })).body;
  assert.equal(outgoing.outgoing.length, 1); assert.equal(outgoing.outgoing[0].accountId, 'B'); assert.equal(outgoing.outgoing[0].status, 'pending');
  assert.deepEqual(outgoing.accepted, []); assert.deepEqual(outgoing.incoming, []);
  assert.equal((await call(env, { account: 'B', route: FRIENDS })).body.incoming[0].accountId, 'A');
  assert.deepEqual((await call(env, { account: 'C', route: FRIENDS })).body, { accepted: [], incoming: [], outgoing: [] });
  for (const account of ['A', 'C']) assert.equal((await call(env, { account, route: FRIENDS + '/' + friendship.id + '/respond', method: 'POST', body: { accept: true } })).status, 404);
  assert.equal((await call(env, { account: 'B', route: FRIENDS + '/' + friendship.id + '/respond', method: 'POST', body: { accept: 'yes' } })).status, 422);
  const accepted = await accept(env, friendship);
  assert.equal(accepted.status, 'accepted'); assert.equal(typeof accepted.acceptedAt, 'number');
  for (const [account, target] of [['A', 'B'], ['B', 'A']]) {
    const listed = (await call(env, { account, route: FRIENDS })).body;
    assert.deepEqual(listed.incoming, []); assert.deepEqual(listed.outgoing, []); assert.equal(listed.accepted[0].accountId, target);
    assert.deepEqual(Object.keys(listed.accepted[0]).sort(), ['acceptedAt', 'accountId', 'bio', 'displayName', 'id', 'requestedAt', 'status'].sort());
  }
  await profile(env, 'B', { visible: false, bio: 'Tajný príbeh', expectedRevision: 1 });
  assert.equal((await call(env, { route: FRIENDS })).body.accepted[0].bio, '');
  const privateDuplicate = await call(env, { route: FRIENDS + '/request', method: 'POST', body: { accountId: 'B' } });
  assert.equal(privateDuplicate.status, 200); assert.equal(privateDuplicate.body.friendship.bio, '');
  assert.equal((await call(env, { account: 'C', route: FRIENDS + '/' + friendship.id, method: 'DELETE', body: {} })).status, 404);
});

test('simultaneous reciprocal requests create exactly one pending request and never accept it implicitly', async t => {
  const env = fixture(t); await profile(env, 'A'); await profile(env, 'B');
  const results = await Promise.all([['A', 'B'], ['B', 'A']].map(([account, accountId]) => call(env, { account, route: FRIENDS + '/request', method: 'POST', body: { accountId } })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 201]);
  assert.equal(results[0].body.friendship.id, results[1].body.friendship.id);
  assert.ok(results.every(result => result.body.friendship.status === 'pending'));
  assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM social_friendships').get().n, 1);
});

test('recipient refusal and participant cancellation remove pending requests; either friend can end a friendship', async t => {
  const env = fixture(t);
  await profile(env, 'B');
  for (const [method, account] of [['decline', 'B'], ['cancel', 'A'], ['cancel', 'B']]) {
    const friendship = await friendRequest(env);
    const result = await call(env, { account, route: FRIENDS + '/' + friendship.id + (method === 'decline' ? '/respond' : ''), method: method === 'decline' ? 'POST' : 'DELETE', body: method === 'decline' ? { accept: false } : {} });
    assert.equal(result.status, 200); assert.deepEqual(result.body, { ok: true });
    for (const participant of ['A', 'B']) assert.deepEqual((await call(env, { account: participant, route: FRIENDS })).body, { accepted: [], incoming: [], outgoing: [] });
  }
  const friendship = await friendRequest(env); await accept(env, friendship);
  assert.equal((await call(env, { account: 'B', route: FRIENDS + '/' + friendship.id, method: 'DELETE', body: {} })).status, 200);
  assert.deepEqual((await call(env, { route: FRIENDS })).body.accepted, []);
  assert.equal((await call(env, { route: MAIL, method: 'POST', body: { recipientId: 'B', subject: 'Pozdrav', text: 'Text' } })).status, 403);
  for (const accountId of ['A', '', 42]) assert.equal((await call(env, { route: FRIENDS + '/request', method: 'POST', body: { accountId } })).status, 422);
  assert.equal((await call(env, { route: FRIENDS + '/request', method: 'POST', body: { accountId: 'missing' } })).status, 404);
  assert.equal((await call(env, { route: FRIENDS + '/request', method: 'POST', body: { accountId: 'C' } })).status, 404);
});

test('mail is exchanged only by accepted friends, stays private to participants, and GET never marks it read', async t => {
  const env = fixture(t);
  await profile(env, 'B');
  for (const pending of [false, true]) {
    if (pending) await friendRequest(env);
    assert.equal((await call(env, { route: MAIL, method: 'POST', body: { recipientId: 'B', subject: 'Pozdrav', text: 'Text' } })).status, 403);
  }
  const friendship = (await call(env, { route: FRIENDS })).body.outgoing[0]; await accept(env, friendship);
  const message = await send(env, { senderId: 'C', senderName: 'Podvrh', recipientName: 'Podvrh', readAt: 1, createdAt: 1 });
  assert.equal(message.senderId, 'A'); assert.equal(message.senderName, 'Čarodej A'); assert.equal(message.recipientId, 'B'); assert.equal(message.recipientName, 'Čarodej B');
  assert.equal(message.readAt, null); assert.equal(typeof message.createdAt, 'number'); assert.notEqual(message.createdAt, 1);
  assert.deepEqual(Object.keys(message).sort(), ['id', 'senderId', 'senderName', 'recipientId', 'recipientName', 'subject', 'text', 'createdAt', 'readAt'].sort());
  for (const account of ['A', 'B']) {
    assert.deepEqual((await call(env, { account, route: MAIL + '/' + message.id })).body.message, message);
    assert.equal(env.DB.sqlite.prepare('SELECT read_at FROM social_mail WHERE id=?').get(message.id).read_at, null);
  }
  assert.deepEqual((await call(env, { route: MAIL + '?box=sent' })).body, { messages: [message], truncated: false, nextOffset: null });
  assert.deepEqual((await call(env, { account: 'B', route: MAIL + '?box=inbox' })).body.messages, [message]);
  for (const box of ['inbox', 'sent']) assert.deepEqual((await call(env, { account: 'C', route: MAIL + '?box=' + box + '&accountId=A' })).body.messages, []);
  assert.equal((await call(env, { account: 'C', route: MAIL + '/' + message.id })).status, 404);
  for (const account of ['A', 'C']) assert.equal((await call(env, { account, route: MAIL + '/' + message.id + '/read', method: 'POST', body: {} })).status, 404);
  const read = await call(env, { account: 'B', route: MAIL + '/' + message.id + '/read', method: 'POST', body: {} });
  assert.equal(read.status, 200); assert.equal(typeof read.body.message.readAt, 'number');
  const reread = await call(env, { account: 'B', route: MAIL + '/' + message.id + '/read', method: 'POST', body: {} });
  assert.equal(reread.body.message.readAt, read.body.message.readAt);
  assert.equal((await call(env, { route: MAIL + '/' + message.id })).body.message.readAt, read.body.message.readAt);
});

test('mail validates field types and limits, keeps plain text, and reports bounded inbox/sent lists', async t => {
  const env = fixture(t); await befriend(env);
  const boundary = await send(env, { subject: 'ž'.repeat(160), text: 'ž'.repeat(10000) });
  assert.equal(boundary.subject.length, 160); assert.equal(boundary.text.length, 10000);
  const plain = await send(env, { subject: '  Pozdrav  ', text: '<script>text</script>\n\tDruhý riadok' });
  assert.equal(plain.subject, 'Pozdrav'); assert.equal(plain.text, '<script>text</script>\n\tDruhý riadok');
  for (const changes of [{ subject: 'x'.repeat(161) }, { text: 'x'.repeat(10001) }, { subject: ' \t' }, { subject: 1 }, { text: [] }, { subject: '\u0000' }, { text: '\u007f' }, { text: ' \n\t' }, { recipientId: 'A' }, { recipientId: 1 }, { recipientId: '' }]) assert.equal((await call(env, { route: MAIL, method: 'POST', body: { recipientId: 'B', subject: 'Pozdrav', text: 'Text', ...changes } })).status, 422, JSON.stringify(changes));
  const limited = await call(env, { account: 'B', route: MAIL + '?box=inbox&limit=1' });
  assert.equal(limited.body.messages.length, 1); assert.equal(limited.body.truncated, true);
  assert.equal(limited.body.nextOffset, 1);
  assert.equal((await call(env, { account: 'B', route: MAIL + '?box=inbox&limit=2' })).body.truncated, false);
  for (const query of ['?box=other', '?box=sent&limit=0', '?box=sent&limit=1.5', '?box=inbox&limit=nope']) assert.equal((await call(env, { route: MAIL + query })).status, 400);
});

function seedFriendships(env, account, count) {
  const insert = env.DB.sqlite.prepare('INSERT INTO social_friendships(id,pair_low,pair_high,requester_id,recipient_id,status,requested_at,accepted_at) VALUES(?,?,?,?,?,?,?,?)');
  for (let n = 0; n < count; n++) {
    const other = account + '-seed-' + n; addAccount(env, other);
    const pair = [account, other].sort();
    insert.run('friend-' + other, pair[0], pair[1], account, other, n % 2 ? 'pending' : 'accepted', 1, n % 2 ? null : 1);
  }
}
function seedMail(env, count, sender = 'A', recipient = 'B', createdAt = Date.now() - 2 * 86400000, prefix = sender + recipient) {
  const insert = env.DB.sqlite.prepare('INSERT INTO social_mail(id,sender_id,recipient_id,subject,text,created_at,read_at) VALUES(?,?,?,?,?,?,NULL)');
  for (let n = 0; n < count; n++) insert.run(prefix + '-' + n, sender, recipient, 'List ' + n, 'Text', createdAt);
}

test('mail pagination reaches messages after the first fifty without duplicate or missing entries', async t => {
  const env = fixture(t); seedMail(env, 61);
  for (const [account, box] of [['A', 'sent'], ['B', 'inbox']]) {
    const first = await call(env, { account, route: MAIL + '?box=' + box });
    assert.equal(first.status, 200); assert.equal(first.body.messages.length, 50); assert.equal(first.body.truncated, true); assert.equal(first.body.nextOffset, 50);
    const second = await call(env, { account, route: MAIL + '?box=' + box + '&offset=' + first.body.nextOffset });
    assert.equal(second.status, 200); assert.equal(second.body.messages.length, 11); assert.equal(second.body.truncated, false); assert.equal(second.body.nextOffset, null);
    assert.equal(new Set([...first.body.messages, ...second.body.messages].map(message => message.id)).size, 61);
    assert.deepEqual((await call(env, { account, route: MAIL + '?box=' + box + '&offset=61' })).body.messages, []);
  }
  for (const offset of ['-1', '1.5', '501', 'nope']) assert.equal((await call(env, { route: MAIL + '?offset=' + offset })).status, 400);
});

test('friendship caps are atomic for requester and recipient and duplicate requests never consume another slot', async t => {
  for (const capped of ['A', 'B']) {
    const env = fixture(t);
    await profile(env, 'A'); await profile(env, 'B'); await profile(env, 'C');
    seedFriendships(env, capped, 499);
    const attempts = capped === 'A' ? [['A', 'B'], ['A', 'C']] : [['A', 'B'], ['C', 'B']];
    const results = await Promise.all(attempts.map(([account, accountId]) => call(env, { account, route: FRIENDS + '/request', method: 'POST', body: { accountId } })));
    assert.deepEqual(results.map(r => r.status).sort(), [201, 422], capped);
    assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM social_friendships WHERE requester_id=? OR recipient_id=?').get(capped, capped).n, 500);
    const winner = attempts[results.findIndex(r => r.status === 201)];
    const duplicate = await call(env, { account: winner[0], route: FRIENDS + '/request', method: 'POST', body: { accountId: winner[1] } });
    assert.equal(duplicate.status, 200); assert.equal(duplicate.body.friendship.status, 'pending');
  }
});

test('mail retention cap counts sent and received mail atomically for both participants', async t => {
  for (const capped of ['A', 'B']) {
    const env = fixture(t); await befriend(env);
    seedMail(env, 250, capped, 'C', undefined, capped + '-out');
    seedMail(env, 249, 'C', capped, undefined, capped + '-in');
    const results = await Promise.all([1, 2].map(n => call(env, { route: MAIL, method: 'POST', body: { recipientId: 'B', subject: 'Posledný ' + n, text: 'Text' } })));
    assert.deepEqual(results.map(r => r.status).sort(), [201, 422], capped);
    assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM social_mail WHERE sender_id=? OR recipient_id=?').get(capped, capped).n, 500);
  }
});

test('the sender mail rate limit is atomic and rolling over 24 hours without limiting the other sender', async t => {
  const env = fixture(t); await befriend(env);
  seedMail(env, 30, 'A', 'B', Date.now() - 86400000 - 10000, 'expired');
  seedMail(env, 29, 'A', 'B', Date.now() - 60000, 'recent');
  const results = await Promise.all([1, 2].map(n => call(env, { route: MAIL, method: 'POST', body: { recipientId: 'B', subject: 'Denný ' + n, text: 'Text' } })));
  assert.deepEqual(results.map(r => r.status).sort(), [201, 429]);
  assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM social_mail WHERE sender_id=? AND created_at>?').get('A', Date.now() - 86400000).n, 30);
  await send(env, { recipientId: 'A' }, 'B');
});

test('deleting an account cascades social records while preserving unrelated wizard data', async t => {
  const env = fixture(t); await befriend(env); await profile(env, 'A'); await profile(env, 'C');
  await send(env); seedMail(env, 1, 'B', 'C', undefined, 'unrelated');
  env.DB.sqlite.prepare('DELETE FROM wizard_accounts WHERE id=?').run('A');
  assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM social_profiles WHERE account_id=?').get('A').n, 0);
  assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM social_friendships WHERE requester_id=? OR recipient_id=?').get('A', 'A').n, 0);
  assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM social_mail WHERE sender_id=? OR recipient_id=?').get('A', 'A').n, 0);
  assert.equal((await call(env, { account: 'C' })).body.profile.bio, 'Príbeh C');
  assert.equal((await call(env, { account: 'C', route: MAIL + '?box=inbox' })).body.messages[0].id, 'unrelated-0');
});
