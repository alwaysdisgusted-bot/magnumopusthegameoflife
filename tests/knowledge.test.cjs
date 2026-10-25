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
const auth = load('auth'), { handleKnowledgeRequest } = load('knowledge', { './auth': auth });
const M = require('../server/knowledge-model.mjs').default;
const hash = value => createHash('sha256').update(value).digest('hex');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5V8AAAAASUVORK5CYII=', 'base64');
class Statement {
  constructor(db, sql, values = []) { this.db = db; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.db, this.sql, values); }
  async first() {
    if (this.db.failReferenceRead && /^SELECT (?:account_id|id) FROM knowledge_\w+ WHERE object_key=/.test(this.sql)) throw new Error('Reference read unavailable');
    return this.db.sqlite.prepare(this.sql).get(...this.values) || null;
  }
  async all() { return { success: true, results: this.db.sqlite.prepare(this.sql).all(...this.values), meta: {} }; }
  async run() {
    const mutation = /^(?:INSERT INTO|UPDATE) knowledge_/.test(this.sql);
    if (mutation && this.db.failBeforeWrite) { this.db.failBeforeWrite = false; throw new Error('Before commit'); }
    const result = this.db.sqlite.prepare(this.sql).run(...this.values);
    if (mutation && this.db.failAfterWrite) { this.db.failAfterWrite = false; throw new Error('After commit'); }
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }
}
class TestD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:'); this.sqlite.exec('PRAGMA foreign_keys=ON');
    const folder = path.resolve(__dirname, '../drizzle');
    for (const name of fs.readdirSync(folder).filter(name => name.endsWith('.sql')).sort()) this.sqlite.exec(fs.readFileSync(path.join(folder, name), 'utf8'));
  }
  prepare(sql) { return new Statement(this, sql); }
}
class TestBucket {
  objects = new Map(); deleted = [];
  async put(key, contents) {
    if (this.failPut) { this.failPut = false; throw new Error('Storage unavailable'); }
    this.objects.set(key, Buffer.from(contents));
    if (this.barrier) await this.barrier();
    return { key };
  }
  async get(key) {
    if (this.beforeGet) await this.beforeGet(key);
    const bytes = this.objects.get(key);
    return bytes === undefined ? null : { size: bytes.length, body: Uint8Array.from(bytes), text: async () => bytes.toString('utf8') };
  }
  async delete(key) { this.deleted.push(key); this.objects.delete(key); }
}
function fixture(t) {
  const env = { DB: new TestD1(), BUCKET: new TestBucket() }; t.after(() => env.DB.sqlite.close());
  for (const id of ['A', 'B']) {
    env.DB.sqlite.prepare('INSERT INTO wizard_accounts(id,owner_id,normalized_name,display_name,password_hash,created_at) VALUES(?,?,?,?,?,?)').run(id, 'owner-' + id, 'wizard-' + id, 'Čarodej ' + id, 'not-used', Date.now());
    env.DB.sqlite.prepare('INSERT INTO wizard_sessions(token_hash,account_id,owner_id,csrf_value,expires_at) VALUES(?,?,?,?,?)').run(hash(hash('session-' + id)), id, 'owner-' + id, hash('csrf-' + id), Date.now() + 86400000);
  }
  return env;
}
function request(options = {}) {
  const { account = 'A', method = 'GET', body, route = '/api/knowledge', origin = 'https://game.example', noCsrf, noSession, noOwner, owner, header = '1', contentLength } = options;
  const headers = { 'oai-authenticated-user-id': owner ?? ('owner-' + account), Cookie: '__Host-mo-session=' + hash('session-' + account) };
  if (noSession) delete headers.Cookie;
  if (noOwner) delete headers['oai-authenticated-user-id'];
  if (method !== 'GET') Object.assign(headers, { Origin: origin, 'X-MO-Request': header, 'X-MO-CSRF': noCsrf ? '' : hash('csrf-' + account) });
  const multipart = body instanceof FormData;
  if (body !== undefined && !multipart) headers['Content-Type'] = 'application/json';
  if (contentLength) headers['Content-Length'] = String(contentLength);
  return new Request('https://game.example' + route, { method, headers, body: body === undefined ? undefined : multipart ? body : JSON.stringify(body) });
}
async function call(env, options = {}) {
  const response = await handleKnowledgeRequest(request(options), env); assert.ok(response);
  return { status: response.status, headers: response.headers, body: response.headers.get('Content-Type').includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
}
const resource = (patch = {}) => ({ id: 'r-1', sourceKind: 'upload', sourceId: 'file-1', title: 'Podklad', text: 'Kognitívne procesy', assetId: null, mime: 'text/plain', conceptIds: ['cognition'], manualConceptIds: [], excludedConceptIds: [], analysisStatus: 'indexed', analyzedAt: 1, updatedAt: 1, pages: [], pagination: 'unpaginated', ...patch });
const state = (patch = {}) => ({ ...M.createState(), resources: [resource(patch)] });
const put = (env, data = state(), expectedRevision = 0, options = {}) => call(env, { method: 'PUT', body: { state: data, expectedRevision, accountId: 'B' }, ...options });
const pointer = env => env.DB.sqlite.prepare('SELECT * FROM knowledge_maps WHERE account_id=?').get('A');
function form(bytes = Buffer.from('Kognícia a pamäť.'), name = 'poznamka.txt', mime = 'text/plain') { const data = new FormData(); data.append('file', new Blob([bytes], { type: mime }), name); return data; }
const upload = (env, bytes, name, mime, options = {}) => call(env, { method: 'POST', route: '/api/knowledge/files', body: form(bytes, name, mime), ...options });
function docx(extra = []) {
  const files = [['[Content_Types].xml', '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'], ['word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>'], ['_rels/.rels', '<Relationships/>'], ...extra];
  const locals = [], central = []; let offset = 0;
  for (const [name, text] of files) {
    const nameBytes = Buffer.from(name), bytes = Buffer.from(text), local = Buffer.alloc(30), record = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt32LE(bytes.length, 20); record.writeUInt32LE(bytes.length, 24); record.writeUInt16LE(nameBytes.length, 28); record.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, bytes); central.push(record, nameBytes); offset += local.length + nameBytes.length + bytes.length;
  }
  const records = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(records.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, records, end]);
}

test('knowledge map requires the owner session and same-origin CSRF writes; private state stays isolated', async t => {
  const env = fixture(t);
  assert.deepEqual((await call(env)).body, { state: M.createState(), revision: 0, updatedAt: null });
  for (const options of [{ noSession: true }, { noOwner: true }, { owner: 'owner-B' }]) {
    assert.equal((await call(env, options)).status, 401); assert.equal((await put(env, state(), 0, options)).status, 401);
  }
  for (const options of [{ noCsrf: true }, { origin: 'https://attacker.example' }, { header: '0' }]) {
    assert.equal((await put(env, state(), 0, options)).status, 403);
    assert.equal((await upload(env, undefined, undefined, undefined, options)).status, 403);
  }
  assert.equal((await put(env)).status, 200);
  assert.equal((await call(env, { account: 'B', route: '/api/knowledge?accountId=A' })).body.revision, 0);
  assert.deepEqual((await call(env)).body.state, state());
  assert.match((await call(env)).headers.get('Cache-Control'), /no-store, private/);
  assert.equal(await handleKnowledgeRequest(request({ route: '/api/other' }), env), null);
});

test('concurrent revisioned writes select one winner and remove only unused map blobs', async t => {
  const env = fixture(t);
  for (const revision of [0, 1]) {
    let arrivals = 0, release; const waiting = new Promise(resolve => { release = resolve; });
    env.BUCKET.barrier = async () => { if (++arrivals === 2) release(); await waiting; };
    const results = await Promise.all([put(env, state({ text: 'Prvý' }), revision), put(env, state({ text: 'Druhý' }), revision)]);
    env.BUCKET.barrier = null;
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    assert.equal(pointer(env).revision, revision + 1); assert.equal(env.BUCKET.objects.size, 1);
  }
  for (const revision of [-1, 0.5, '2', Number.MAX_SAFE_INTEGER]) assert.equal((await put(env, state(), revision)).status, 422);
  assert.equal((await put(env, state(), 1)).status, 409);
  assert.equal((await put(env, { ...state(), sourceURL: 'https://other.example' }, 2)).status, 422);
});

test('safe text, PDF, DOCX and raster originals are stored intact behind private downloads', async t => {
  const env = fixture(t), pdf = Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');
  for (const [bytes, name, mime] of [[Buffer.from('Kognícia a pamäť.'), 'poznámka.txt', 'text/plain'], [Buffer.from('# Kognícia'), 'štúdium.md', 'text/markdown'], [pdf, 'paper.pdf', 'application/pdf'], [docx(), 'paper.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], [PNG, '../fotka.png', 'image/png']]) {
    const saved = await upload(env, bytes, name, mime); assert.equal(saved.status, 201, JSON.stringify(saved.body));
    const item = saved.body.file; assert.equal(item.size, bytes.length); assert.equal(item.mime, mime); assert.ok(!item.name.includes('/'));
    const loaded = await call(env, { route: item.url }); assert.equal(loaded.status, 200); assert.deepEqual(loaded.body, bytes);
    assert.equal(loaded.headers.get('Content-Type'), mime.startsWith('image/') ? mime : 'application/octet-stream');
    assert.match(loaded.headers.get('Content-Disposition'), mime.startsWith('image/') ? /^inline/ : /^attachment/);
    assert.equal(loaded.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal((await call(env, { route: item.url, account: 'B' })).status, 404);
    assert.equal((await call(env, { route: item.url, noSession: true })).status, 401);
  }
});

test('uploads reject spoofed types, executable or macro packages, malformed images and oversize bodies', async t => {
  const env = fixture(t);
  const invalid = [[Buffer.from('<svg/>'), 'a.svg', 'image/svg+xml'], [Buffer.from('<html>unsafe'), 'a.txt', 'text/plain'], [Buffer.from('MZ\u0000exe'), 'a.txt', 'text/plain'], [Buffer.from([255, 254, 0]), 'a.txt', 'text/plain'], [PNG, 'a.jpg', 'image/jpeg'], [PNG.subarray(0, 35), 'a.png', 'image/png'], [docx([['word/vbaProject.bin', 'macro']]), 'a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], [docx([['../evil.xml', 'bad']]), 'a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], [Buffer.from('%PDF-1.7\ntruncated'), 'a.pdf', 'application/pdf']];
  for (const input of invalid) assert.equal((await upload(env, ...input)).status, 422, input[1]);
  assert.equal((await upload(env, Buffer.alloc(15 * 1024 * 1024 + 1, 65))).status, 413);
  assert.equal((await upload(env, undefined, undefined, undefined, { contentLength: 16 * 1024 * 1024 })).status, 413);
  assert.equal(env.BUCKET.objects.size, 0);
});

test('map assets must belong to the current account and keep their actual file MIME', async t => {
  const env = fixture(t), own = (await upload(env)).body.file, foreign = (await upload(env, undefined, undefined, undefined, { account: 'B' })).body.file;
  assert.equal((await put(env, state({ assetId: foreign.id }))).status, 422);
  assert.equal((await put(env, state({ assetId: own.id, mime: 'application/pdf' }))).status, 422);
  assert.equal((await put(env, state({ assetId: own.id }))).status, 200);
  assert.equal((await call(env)).body.state.resources[0].assetId, own.id);
  assert.equal(env.DB.sqlite.prepare('SELECT count(*) count FROM knowledge_maps').get().count, 1);
});

test('storage errors retain committed maps and files, while confirmed failed writes clean up safely', async t => {
  const env = fixture(t);
  env.DB.failAfterWrite = true; assert.equal((await put(env)).status, 503);
  assert.equal((await call(env)).body.revision, 1); assert.ok(env.BUCKET.objects.has(pointer(env).object_key));
  const old = pointer(env).object_key;
  env.DB.failBeforeWrite = true; assert.equal((await put(env, state({ text: 'Uncommitted' }), 1)).status, 503);
  assert.equal(pointer(env).object_key, old); assert.equal(env.BUCKET.objects.size, 1);
  env.BUCKET.failPut = true; assert.equal((await put(env, state(), 1)).status, 503); assert.equal(pointer(env).object_key, old);
  env.DB.failAfterWrite = true; assert.equal((await upload(env)).status, 503);
  const committed = env.DB.sqlite.prepare('SELECT object_key FROM knowledge_files').get(); assert.ok(env.BUCKET.objects.has(committed.object_key));
  env.DB.failBeforeWrite = true; env.DB.failReferenceRead = true; const count = env.BUCKET.objects.size;
  assert.equal((await upload(env)).status, 503); assert.equal(env.BUCKET.objects.size, count + 1);
});

test('map reads retry stale pointers and report missing or corrupt storage without replacing existing data', async t => {
  const env = fixture(t); await put(env);
  const old = pointer(env).object_key;
  env.BUCKET.beforeGet = async key => { if (key !== old) return; env.BUCKET.beforeGet = null; assert.equal((await put(env, state({ text: 'Aktuálna verzia' }), 1)).status, 200); };
  const result = await call(env); assert.equal(result.status, 200); assert.equal(result.body.revision, 2); assert.equal(result.body.state.resources[0].text, 'Aktuálna verzia');
  const key = pointer(env).object_key; env.BUCKET.objects.delete(key); assert.equal((await call(env)).status, 503);
  env.BUCKET.objects.set(key, Buffer.from('{broken')); assert.equal((await call(env)).status, 503);
  assert.equal(pointer(env).revision, 2);
});
