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
const { handleLibraryCategories } = load('library-categories', { './auth': auth });
const hash = value => createHash('sha256').update(value).digest('hex');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5V8AAAAASUVORK5CYII=';
class Statement {
  constructor(db, sql, values = []) { this.db = db; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.db, this.sql, values); }
  async first() {
    if (this.db.failReferenceRead && this.sql.startsWith('SELECT id FROM library_photos WHERE object_key=')) throw new Error('Reference read unavailable');
    return this.db.sqlite.prepare(this.sql).get(...this.values) || null;
  }
  async all() { return { success: true, results: this.db.sqlite.prepare(this.sql).all(...this.values), meta: {} }; }
  async run() {
    const mutation = this.sql.startsWith('INSERT INTO library_photos');
    if (mutation && this.db.failBeforeWrite) { this.db.failBeforeWrite = false; throw new Error('D1 write unavailable'); }
    const result = this.db.sqlite.prepare(this.sql).run(...this.values);
    if (mutation && this.db.failAfterWrite) { this.db.failAfterWrite = false; throw new Error('Transport failed after commit'); }
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }
}
class TestD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys=ON');
    const folder = path.resolve(__dirname, '../drizzle');
    for (const name of fs.readdirSync(folder).filter(name => name.endsWith('.sql')).sort()) this.sqlite.exec(fs.readFileSync(path.join(folder, name), 'utf8'));
  }
  prepare(sql) { return new Statement(this, sql); }
}
class TestBucket {
  objects = new Map();
  deleted = [];
  async put(key, bytes) {
    if (this.failPut) throw new Error('Storage unavailable');
    this.objects.set(key, Buffer.from(bytes));
    return { key };
  }
  async get(key) {
    const bytes = this.objects.get(key);
    return bytes === undefined ? null : { size: bytes.length, body: Uint8Array.from(bytes) };
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
  const { account = 'A', method = 'GET', body, route = '/api/library/categories', origin = 'https://game.example', noCsrf, noSession, noOwner, owner, header = '1' } = options;
  const headers = { 'oai-authenticated-user-id': owner ?? ('owner-' + account), Cookie: '__Host-mo-session=' + hash('session-' + account) };
  if (noSession) delete headers.Cookie;
  if (noOwner) delete headers['oai-authenticated-user-id'];
  if (method !== 'GET') Object.assign(headers, { Origin: origin, 'Content-Type': 'application/json', 'X-MO-Request': header, 'X-MO-CSRF': noCsrf ? '' : hash('csrf-' + account) });
  return new Request('https://game.example' + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function call(env, options = {}) {
  const response = await handleLibraryCategories(request(options), env);
  assert.ok(response);
  return { status: response.status, headers: response.headers, body: response.headers.get('Content-Type').includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
}
async function create(env, name = 'Filozofia', options = {}) { return call(env, { method: 'POST', body: { name, accountId: 'B' }, ...options }); }
function photoRoute(categoryId) { return '/api/library/categories/' + categoryId + '/photos'; }
async function upload(env, categoryId, options = {}) { return call(env, { method: 'POST', route: photoRoute(categoryId), body: { image: PNG, caption: 'Moja kniha' }, ...options }); }

test('photo metadata index returns only owner photos with current categories and private URLs', async t => {
  const env = fixture(t);
  const first = (await create(env, 'Filozofia')).body.category;
  const second = (await create(env, 'Nápady')).body.category;
  const foreign = (await create(env, 'Cudzie', { account: 'B' })).body.category;
  const firstPhoto = (await upload(env, first.id)).body.photo;
  const secondPhoto = (await upload(env, second.id, { body: { image: PNG, caption: 'Náčrt' } })).body.photo;
  await upload(env, foreign.id, { account: 'B' });
  await call(env, { method: 'PATCH', route: '/api/library/categories/' + first.id, body: { name: 'Filozofické knihy', expectedRevision: first.revision } });
  const insert = env.DB.sqlite.prepare('INSERT INTO library_photos VALUES(?,?,?,?,?,?,?,?,?,?)');
  insert.run('00000000-0000-0000-0000-000000000001', foreign.id, 'A', 'Mismatched owner', 'unused/mismatch', 'image/png', 1, 1, 1, 0);
  insert.run('../../private', first.id, 'A', 'Unsafe legacy ID', 'unused/unsafe', 'image/png', 1, 1, 1, 0);
  env.BUCKET.get = async () => { assert.fail('Metadata index must not read image objects'); };
  const result = await call(env, { route: '/api/library/photos?accountId=B' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.photos.sort((a, b) => a.id.localeCompare(b.id)), [
    { id: firstPhoto.id, categoryId: first.id, categoryName: 'Filozofické knihy', caption: 'Moja kniha', url: '/api/library/photos/' + firstPhoto.id },
    { id: secondPhoto.id, categoryId: second.id, categoryName: 'Nápady', caption: 'Náčrt', url: '/api/library/photos/' + secondPhoto.id },
  ].sort((a, b) => a.id.localeCompare(b.id)));
  assert.match(result.headers.get('Cache-Control'), /no-store, private/);
  assert.equal(result.headers.get('Vary'), 'Cookie');
  assert.equal(result.headers.get('Pragma'), 'no-cache');
});
test('photo metadata index requires both trusted owner and session but no write credentials', async t => {
  const env = fixture(t);
  for (const options of [{ noSession: true }, { noOwner: true }, { owner: 'owner-B' }]) {
    assert.equal((await call(env, { route: '/api/library/photos', ...options })).status, 401);
  }
  const category = (await create(env)).body.category;
  const saved = (await upload(env, category.id)).body.photo;
  assert.deepEqual((await call(env, { route: '/api/library/photos', account: 'B' })).body, { photos: [] });
  assert.equal((await call(env, { route: '/api/library/photos', noCsrf: true, header: '0' })).body.photos[0].id, saved.id);
});
test('photo metadata index bounds results to the account photo quota', async t => {
  const env = fixture(t), category = (await create(env)).body.category;
  const insert = env.DB.sqlite.prepare('INSERT INTO library_photos VALUES(?,?,?,?,?,?,?,?,?,?)');
  const id = value => value.toString(16).padStart(8, '0') + '-0000-0000-0000-000000000000';
  for (let i = 1; i <= 2001; i++) insert.run(id(i), category.id, 'A', '', 'unused/' + i, 'image/png', 1, 1, 1, i);
  const result = await call(env, { route: '/api/library/photos' });
  assert.equal(result.status, 200);
  assert.equal(result.body.photos.length, 2000);
  assert.equal(result.body.photos[0].id, id(1));
  assert.equal(result.body.photos[1999].id, id(2000));
  assert.equal(env.BUCKET.objects.size, 0);
});

test('categories and photos are account-private, names normalized and photo counts calculated', async t => {
  const env = fixture(t);
  assert.deepEqual((await call(env)).body, { categories: [] });
  const created = await create(env, '  Moja   filozofia  ');
  assert.equal(created.status, 201);
  const category = created.body.category;
  assert.equal(category.name, 'Moja filozofia');
  assert.equal(category.revision, 1);
  assert.equal(category.photoCount, 0);
  assert.match(category.id, /^[a-f0-9-]{36}$/);
  assert.deepEqual((await call(env, { account: 'B', route: '/api/library/categories?accountId=A' })).body, { categories: [] });
  assert.equal((await create(env, 'moja filozofia')).status, 409);
  assert.equal((await create(env, 'moja filozofia', { account: 'B' })).status, 201);
  assert.equal((await upload(env, category.id)).status, 201);
  assert.equal((await call(env)).body.categories[0].photoCount, 1);
  assert.equal((await call(env)).body.categories[0].revision, 1);
});
test('trusted owner, session, CSRF and same-origin JSON writes remain mandatory', async t => {
  const env = fixture(t);
  for (const options of [{ noSession: true }, { noOwner: true }, { owner: 'owner-B' }]) {
    assert.equal((await call(env, options)).status, 401);
    assert.equal((await create(env, 'Test', options)).status, 401);
  }
  for (const options of [{ noCsrf: true }, { origin: 'https://attacker.example' }, { header: '0' }]) assert.equal((await create(env, 'Test', options)).status, 403);
  assert.equal(await handleLibraryCategories(request({ route: '/api/elsewhere' }), env), null);
  assert.match((await call(env)).headers.get('Cache-Control'), /no-store, private/);
});
test('category edits use revisions and cannot rename another account category', async t => {
  const env = fixture(t), category = (await create(env)).body.category;
  const options = { method: 'PATCH', route: '/api/library/categories/' + category.id, body: { name: 'Spinoza', expectedRevision: 1 } };
  assert.equal((await call(env, { ...options, account: 'B' })).status, 404);
  const updated = await call(env, options);
  assert.equal(updated.status, 200);
  assert.equal(updated.body.category.revision, 2);
  assert.equal((await call(env, options)).status, 409);
  assert.equal((await call(env, { ...options, body: { name: 'Iné', expectedRevision: 0 } })).status, 422);
  assert.equal((await call(env)).body.categories[0].name, 'Spinoza');
});
test('names, captions and atomic category quota are bounded', async t => {
  const env = fixture(t);
  for (const name of ['', ' '.repeat(4), 'a'.repeat(81), 'Zlé\u0000meno', null]) assert.equal((await create(env, name)).status, 422);
  const category = (await create(env)).body.category;
  assert.equal((await upload(env, category.id, { body: { image: PNG, caption: 'a'.repeat(301) } })).status, 422);
  for (let i = 1; i < 100; i++) env.DB.sqlite.prepare('INSERT INTO library_categories VALUES(?,?,?,?,?,?)').run('fill-' + i, 'A', 'Fill ' + i, 'fill ' + i, 1, i);
  assert.equal((await create(env, 'Navyše')).status, 409);
  assert.equal((await call(env)).body.categories.length, 100);
});
test('uploaded raster is served privately and cross-account photo access is denied', async t => {
  const env = fixture(t), category = (await create(env)).body.category;
  const result = await upload(env, category.id);
  assert.equal(result.status, 201);
  const photo = result.body.photo;
  assert.equal(photo.width, 1); assert.equal(photo.height, 1);
  assert.equal(photo.caption, 'Moja kniha');
  assert.equal((await call(env, { route: photoRoute(category.id) })).body.photos[0].id, photo.id);
  assert.equal((await call(env, { route: photoRoute(category.id), account: 'B' })).status, 404);
  assert.equal((await upload(env, category.id, { account: 'B' })).status, 404);
  assert.equal((await call(env, { route: photo.url, account: 'B' })).status, 404);
  const binary = await call(env, { route: photo.url });
  assert.equal(binary.status, 200); assert.equal(binary.headers.get('Content-Type'), 'image/png');
  assert.match(binary.headers.get('Cache-Control'), /no-store, private/);
  assert.equal(binary.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.deepEqual(binary.body, Buffer.from(PNG.split(',')[1], 'base64'));
  assert.match([...env.BUCKET.objects.keys()][0], new RegExp('^library/A/' + category.id + '/'));
});
test('SVG, MIME mismatch, malformed or oversized images and enormous dimensions are rejected', async t => {
  const env = fixture(t), category = (await create(env)).body.category;
  const huge = Buffer.from(PNG.split(',')[1], 'base64'); huge.writeUInt32BE(50000, 16);
  const invalid = ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', PNG.replace('image/png', 'image/jpeg'), PNG.slice(0, -1), 'data:image/png;base64,' + Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64'), 'data:image/png;base64,' + huge.toString('base64')];
  for (const image of invalid) assert.ok([413, 422].includes((await upload(env, category.id, { body: { image } })).status));
  assert.equal(env.BUCKET.objects.size, 0);
});
test('photo deletion is owner-scoped, removes storage and updates the category count', async t => {
  const env = fixture(t), category = (await create(env)).body.category, photo = (await upload(env, category.id)).body.photo;
  const options = { method: 'DELETE', route: photo.url, body: {} };
  assert.equal((await call(env, { ...options, account: 'B' })).status, 404);
  assert.equal((await call(env, { ...options, noCsrf: true })).status, 403);
  assert.equal(env.BUCKET.objects.size, 1);
  assert.deepEqual((await call(env, options)).body, { ok: true });
  assert.equal(env.BUCKET.objects.size, 0);
  assert.equal((await call(env)).body.categories[0].photoCount, 0);
  assert.equal((await call(env, { route: photo.url })).status, 404);
});
test('photo limits are enforced atomically and an unsuccessful insert removes only its orphan', async t => {
  const env = fixture(t), category = (await create(env)).body.category;
  for (let i = 0; i < 300; i++) env.DB.sqlite.prepare('INSERT INTO library_photos VALUES(?,?,?,?,?,?,?,?,?,?)').run('fill-' + i, category.id, 'A', '', 'unused/' + i, 'image/png', 1, 1, 1, i);
  assert.equal((await upload(env, category.id)).status, 409);
  assert.equal(env.BUCKET.objects.size, 0);
  assert.equal(env.BUCKET.deleted.length, 1);
  assert.equal((await call(env)).body.categories[0].photoCount, 300);
});
test('transport failure after committed metadata cannot delete the committed photo', async t => {
  const env = fixture(t), category = (await create(env)).body.category;
  env.DB.failAfterWrite = true;
  assert.equal((await upload(env, category.id)).status, 503);
  assert.equal(env.BUCKET.objects.size, 1);
  assert.equal(env.BUCKET.deleted.length, 0);
  const rows = (await call(env, { route: photoRoute(category.id) })).body.photos;
  assert.equal(rows.length, 1);
  assert.equal((await call(env, { route: rows[0].url })).status, 200);
});
test('metadata or storage failure leaves previously stored photos intact', async t => {
  const env = fixture(t), category = (await create(env)).body.category, original = (await upload(env, category.id)).body.photo;
  env.DB.failBeforeWrite = true;
  assert.equal((await upload(env, category.id)).status, 503);
  assert.equal(env.BUCKET.objects.size, 1);
  env.BUCKET.failPut = true;
  assert.equal((await upload(env, category.id)).status, 503);
  assert.equal((await call(env, { route: original.url })).status, 200);
});
