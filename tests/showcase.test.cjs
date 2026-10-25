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
const quotes = load('quotes', { './auth': auth });
const { handleCalendarNotes } = load('calendar-notes', { './auth': auth });
const { handleSocial } = load('social', { './auth': auth });
const { handleShowcase } = load('showcase', { './auth': auth, './quotes': quotes });
const hash = value => createHash('sha256').update(value).digest('hex');
class Statement {
  constructor(db, sql, values = []) { this.db = db; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.db, this.sql, values); }
  async first() { return this.db.sqlite.prepare(this.sql).get(...this.values) || null; }
  async all() { return { success: true, results: this.db.sqlite.prepare(this.sql).all(...this.values) }; }
  execute() { const result = this.db.sqlite.prepare(this.sql).run(...this.values); return { success: true, results: [], meta: { changes: Number(result.changes) } }; }
  async run() { return this.execute(); }
}
class TestD1 {
  constructor(beforeUpgrade) {
    this.sqlite = new DatabaseSync(':memory:'); this.sqlite.exec('PRAGMA foreign_keys=ON');
    const folder = path.resolve(__dirname, '../drizzle');
    for (const name of fs.readdirSync(folder).filter(name => name.endsWith('.sql')).sort()) {
      const sql = fs.readFileSync(path.join(folder, name), 'utf8');
      if (beforeUpgrade && /CREATE TABLE [`"]?profile_showcases/.test(sql)) { beforeUpgrade(this.sqlite); beforeUpgrade = null; }
      this.sqlite.exec(sql);
    }
    assert.ok(this.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='profile_showcases'").get(), 'Generate the showcase migration before running these tests.');
    this.sqlite.prepare('SELECT visibility,featured FROM calendar_notes').all();
  }
  prepare(sql) { return new Statement(this, sql); }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try { const result = statements.map(statement => statement.execute()); this.sqlite.exec('COMMIT'); return result; }
    catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
}
function addAccount(sqlite, id) {
  sqlite.prepare('INSERT INTO wizard_accounts(id,owner_id,normalized_name,display_name,password_hash,created_at) VALUES(?,?,?,?,?,?)').run(id, 'owner-' + id, 'wizard-' + id, 'Čarodej ' + id, 'unused', Date.now());
}
function fixture(t) {
  const env = { DB: new TestD1(), BUCKET: {} }; t.after(() => env.DB.sqlite.close());
  for (const id of ['A', 'B', 'C']) {
    addAccount(env.DB.sqlite, id);
    env.DB.sqlite.prepare('INSERT INTO wizard_sessions(token_hash,account_id,owner_id,csrf_value,expires_at) VALUES(?,?,?,?,?)').run(hash(hash('session-' + id)), id, 'owner-' + id, hash('csrf-' + id), Date.now() + 86400000);
  }
  return env;
}
const SHOWCASE = '/api/social/showcase', NOTES = '/api/calendar/notes', WIZARD = '/api/social/wizards/A';
function request(options = {}) {
  const { route = SHOWCASE, account = 'A', method = 'GET', body, rawBody, noSession, noOwner, owner, noCsrf, origin = 'https://game.example', header = '1', contentType = 'application/json' } = options;
  const headers = { 'oai-authenticated-user-id': owner ?? ('owner-' + account), Cookie: '__Host-mo-session=' + hash('session-' + account) };
  if (noSession) delete headers.Cookie;
  if (noOwner) delete headers['oai-authenticated-user-id'];
  if (method !== 'GET') Object.assign(headers, { Origin: origin, 'Content-Type': contentType, 'X-MO-Request': header, 'X-MO-CSRF': noCsrf ? '' : hash('csrf-' + account) });
  return new Request('https://game.example' + route, { method, headers, body: rawBody === undefined ? (body === undefined ? undefined : JSON.stringify(body)) : rawBody });
}
async function call(env, options = {}) {
  const req = request(options), route = new URL(req.url).pathname;
  const handler = route.startsWith('/api/calendar/') ? handleCalendarNotes : route.startsWith('/api/quotes/') ? quotes.handleQuotes : route === '/api/social/profile' ? handleSocial : handleShowcase;
  let response;
  try { response = await handler(req, env); }
  catch (error) { if (!(error instanceof auth.ApiError)) throw error; response = auth.json({ error: { code: error.code, message: error.message } }, error.status); }
  assert.ok(response); return { status: response.status, body: await response.json(), headers: response.headers };
}
function note(overrides = {}) { return { date: '2026-10-19', title: 'Nápad', text: 'Poznámka s osobným textom.', pins: ['bank', 'calendar'], ...overrides }; }
async function createNote(env, overrides = {}, account = 'A') {
  const result = await call(env, { account, route: NOTES, method: 'POST', body: note(overrides) });
  assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body.note;
}
async function updateNote(env, previous, overrides = {}) {
  const result = await call(env, { route: NOTES + '/' + previous.id, method: 'PUT', body: note({ expectedRevision: previous.revision, ...overrides }) });
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.note;
}
async function profile(env, visible = true, expectedRevision = 0, account = 'A') {
  const result = await call(env, { route: '/api/social/profile', account, method: 'PUT', body: { visible, bio: 'Môj príbeh', expectedRevision } });
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.profile;
}
async function saveQuote(env, quoteId = 'text-1', account = 'A', method = 'POST') {
  const result = await call(env, { route: '/api/quotes/saved', account, method, body: { quoteId } });
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result;
}
async function select(env, quoteIds, expectedRevision = 0, account = 'A', extra = {}) {
  return call(env, { account, method: 'PUT', body: { quoteIds, expectedRevision, ...extra } });
}

test('upgrade preserves every existing note as private and new raw inserts use private defaults', t => {
  let upgraded = false;
  const db = new TestD1(sqlite => {
    upgraded = true; addAccount(sqlite, 'legacy');
    sqlite.prepare('INSERT INTO calendar_notes(id,account_id,date,title,text,pins,revision,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('old-note', 'legacy', '2026-10-18', 'Starý názov', 'Súkromný obsah', '["bank"]', 4, 123);
  });
  t.after(() => db.sqlite.close()); assert.equal(upgraded, true);
  assert.deepEqual({ ...db.sqlite.prepare('SELECT title,text,pins,visibility,featured,revision,updated_at FROM calendar_notes WHERE id=?').get('old-note') }, { title: 'Starý názov', text: 'Súkromný obsah', pins: '["bank"]', visibility: 'private', featured: 0, revision: 4, updated_at: 123 });
  db.sqlite.prepare('INSERT INTO calendar_notes(id,account_id,date,title,text,pins,revision,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('default-note', 'legacy', '2026-10-19', 'Nový', 'Text', '[]', 1, 124);
  assert.deepEqual({ ...db.sqlite.prepare('SELECT visibility,featured FROM calendar_notes WHERE id=?').get('default-note') }, { visibility: 'private', featured: 0 });
  assert.throws(() => db.sqlite.prepare("UPDATE calendar_notes SET featured=1 WHERE id='default-note'").run());
});

test('notes require explicit publication and featuring, preserve omitted privacy fields, and immediately revoke a private note', async t => {
  const env = fixture(t); await profile(env); await saveQuote(env);
  const privateNote = await createNote(env, { accountId: 'B', featured: true });
  assert.equal(privateNote.visibility, 'private'); assert.equal(privateNote.featured, false);
  const visible = await createNote(env, { visibility: 'public' });
  assert.equal(visible.featured, false);
  const listed = await call(env, { route: WIZARD, account: 'B' });
  assert.deepEqual(listed.body.quoteIds, []); assert.deepEqual(listed.body.featuredNotes, []); assert.deepEqual(listed.body.notes.map(n => n.id), [visible.id]);
  assert.equal((await call(env, { route: WIZARD + '/notes/' + privateNote.id, account: 'B' })).status, 404);
  assert.equal((await call(env, { route: NOTES + '/' + visible.id, account: 'B' })).status, 404);
  let featured = await updateNote(env, visible, { featured: true });
  featured = await updateNote(env, featured, { title: 'Upravené starším klientom' });
  assert.equal(featured.visibility, 'public'); assert.equal(featured.featured, true);
  assert.equal((await call(env, { route: WIZARD, account: 'B' })).body.featuredNotes[0].id, featured.id);
  const revoked = await updateNote(env, featured, { visibility: 'private', featured: true });
  assert.equal(revoked.featured, false);
  assert.equal((await call(env, { route: WIZARD + '/notes/' + revoked.id, account: 'B' })).status, 404);
  const after = (await call(env, { route: WIZARD, account: 'B' })).body;
  assert.deepEqual(after.featuredNotes, []); assert.deepEqual(after.notes, []);
  assert.equal((await call(env, { route: NOTES + '/' + revoked.id })).body.note.visibility, 'private');
});

test('all-notes owner list includes every date and privacy setting without exposing another account', async t => {
  const env = fixture(t);
  const privateNote = await createNote(env, { date: '2020-01-01', pins: [] });
  const publicNote = await createNote(env, { date: '2030-12-31', visibility: 'public', featured: true, pins: ['library'] });
  const otherNote = await createNote(env, { date: '2026-10-19', visibility: 'public' }, 'B');
  const listed = await call(env, { route: NOTES + '?all=1&accountId=B' });
  assert.equal(listed.status, 200); assert.equal(listed.body.truncated, false);
  assert.deepEqual(listed.body.notes, [publicNote, privateNote]);
  assert.deepEqual((await call(env, { route: NOTES + '?all=1', account: 'B' })).body.notes, [otherNote]);
  for (const query of ['?all=0', '?all=true', '?all=', '?all=1&section=bank', '?all=1&from=2026-10-01', '?all=1&to=2026-10-31', '?all=1&from=2026-10-01&to=2026-10-31', '']) assert.equal((await call(env, { route: NOTES + query })).status, 400, query);
  for (const options of [{ noSession: true }, { noOwner: true }]) assert.equal((await call(env, { route: NOTES + '?all=1', ...options })).status, 401);
});

test('showcase CAS is independent and account-scoped, requires saved catalog quotes, and caps explicit selections at six', async t => {
  const env = fixture(t);
  assert.deepEqual((await call(env)).body, { showcase: { quoteIds: [], revision: 0, updatedAt: null } });
  const chosen = ['text-1', 'text-2', 'scan-1', 'scan-15', 'classic-1', 'classic-24'];
  for (const id of chosen) await saveQuote(env, id);
  await saveQuote(env, 'text-3', 'B');
  for (const ids of [['text-3'], ['text-1', 'text-1'], ['classic-25'], ['scan-16'], ['text-8'], [...chosen, 'text-4'], null, 'text-1', ['text-1\u0000']]) assert.equal((await select(env, ids)).status, 422, JSON.stringify(ids));
  for (const expectedRevision of [undefined, -1, 0.5, '0', Number.MAX_SAFE_INTEGER]) assert.equal((await call(env, { method: 'PUT', body: { quoteIds: [], expectedRevision } })).status, 422);
  const result = await select(env, chosen, 0, 'A', { accountId: 'B', revision: 999 });
  assert.equal(result.status, 200); assert.deepEqual(result.body.showcase.quoteIds, chosen); assert.equal(result.body.showcase.revision, 1);
  assert.equal(typeof result.body.showcase.updatedAt, 'number');
  assert.deepEqual((await call(env, { account: 'B' })).body.showcase.quoteIds, []);
  assert.equal((await select(env, ['text-1'], 1, 'B')).status, 409);
  assert.equal((await select(env, [], 0)).status, 409);
  const simultaneous = await Promise.all([['text-1'], ['text-2']].map(ids => select(env, ids, 1)));
  assert.deepEqual(simultaneous.map(r => r.status).sort(), [200, 409]);
  const current = (await call(env)).body.showcase;
  assert.equal(current.revision, 2); assert.deepEqual(current.quoteIds, simultaneous.find(r => r.status === 200).body.showcase.quoteIds);
  await profile(env); assert.equal((await call(env)).body.showcase.revision, 2);
  assert.equal((await select(env, [], 2)).status, 200);
});

test('removing a saved quote atomically removes its selection and prevents later saving from republishing it', async t => {
  for (const batched of [true, false]) {
    const env = fixture(t); if (!batched) env.DB.batch = undefined;
    await profile(env); for (const id of ['text-1', 'classic-24']) await saveQuote(env, id);
    assert.equal((await select(env, ['text-1', 'classic-24'])).status, 200);
    await saveQuote(env, 'text-1', 'A', 'DELETE');
    let own = (await call(env)).body.showcase;
    assert.deepEqual(own.quoteIds, ['classic-24']); assert.equal(own.revision, 2);
    assert.equal((await select(env, ['text-1', 'classic-24'], 1)).status, 409);
    await saveQuote(env, 'text-1'); own = (await call(env)).body.showcase;
    assert.deepEqual(own.quoteIds, ['classic-24']); assert.equal(own.revision, 2);
    assert.deepEqual((await call(env, { route: WIZARD, account: 'B' })).body.quoteIds, ['classic-24']);
    await saveQuote(env, 'text-1', 'B', 'DELETE'); assert.equal((await call(env)).body.showcase.revision, 2);
    // Defense in depth: stale or unknown database selections never escape through reads.
    env.DB.sqlite.prepare("UPDATE profile_showcases SET quote_ids='[\"text-2\",\"classic-99\",\"classic-24\"]' WHERE account_id='A'").run();
    assert.deepEqual((await call(env, { route: WIZARD, account: 'B' })).body.quoteIds, ['classic-24']);
  }
});

test('saved-quote removal rolls back both writes if a database batch fails and stale editors cannot resurrect a removed selection', async t => {
  const env = fixture(t); await saveQuote(env); await select(env, ['text-1']);
  env.DB.sqlite.exec("CREATE TRIGGER fail_quote_delete BEFORE DELETE ON saved_quotes BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
  await assert.rejects(() => quotes.handleQuotes(request({ route: '/api/quotes/saved', method: 'DELETE', body: { quoteId: 'text-1' } }), env), /test failure/);
  assert.equal(env.DB.sqlite.prepare("SELECT count(*) n FROM saved_quotes WHERE account_id='A'").get().n, 1);
  assert.deepEqual((await call(env)).body.showcase.quoteIds, ['text-1']);
  assert.equal((await call(env)).body.showcase.revision, 1);
  env.DB.sqlite.exec('DROP TRIGGER fail_quote_delete');
  const results = await Promise.all([select(env, ['text-1'], 1), call(env, { route: '/api/quotes/saved', method: 'DELETE', body: { quoteId: 'text-1' } })]);
  assert.equal(results[1].status, 200); assert.ok([200, 409, 422].includes(results[0].status));
  await saveQuote(env); assert.deepEqual((await call(env)).body.showcase.quoteIds, []);
});

test('all profile content requires trusted authentication and opted-in visibility, with a public-only owner preview', async t => {
  const env = fixture(t), privateNote = await createNote(env), publicNote = await createNote(env, { visibility: 'public', featured: true });
  await saveQuote(env); await select(env, ['text-1']);
  for (const route of [SHOWCASE, WIZARD, WIZARD + '/notes/' + publicNote.id]) {
    for (const options of [{ noOwner: true }, { noSession: true }, { owner: 'owner-B' }]) assert.equal((await call(env, { route, ...options })).status, 401);
    assert.match((await call(env, { route })).headers.get('Cache-Control'), /no-store/);
  }
  assert.equal((await call(env, { route: WIZARD, account: 'B' })).status, 404);
  assert.equal((await call(env, { route: WIZARD + '/notes/' + publicNote.id, account: 'B' })).status, 404);
  const preview = (await call(env, { route: WIZARD })).body;
  assert.equal(preview.profile.visible, false); assert.deepEqual(preview.notes.map(n => n.id), [publicNote.id]);
  assert.equal((await call(env, { route: WIZARD + '/notes/' + privateNote.id })).status, 404);
  await profile(env); const publicProfile = (await call(env, { route: WIZARD, account: 'B' })).body;
  assert.deepEqual(Object.keys(publicProfile).sort(), ['featuredNotes', 'nextOffset', 'notes', 'profile', 'quoteIds']);
  assert.deepEqual(Object.keys(publicProfile.profile).sort(), ['accountId', 'bio', 'displayName', 'visible']);
  assert.deepEqual(Object.keys(publicProfile.featuredNotes[0]).sort(), ['featured', 'id', 'text', 'title', 'updatedAt']);
  assert.deepEqual(Object.keys(publicProfile.notes[0]).sort(), ['excerpt', 'featured', 'id', 'title', 'updatedAt']);
  assert.deepEqual((await call(env, { route: WIZARD + '/notes/' + publicNote.id, account: 'B' })).body.note, publicProfile.featuredNotes[0]);
  await profile(env, true, 0, 'B');
  assert.equal((await call(env, { route: '/api/social/wizards/B/notes/' + publicNote.id, account: 'C' })).status, 404);
  assert.equal((await call(env, { route: '/api/social/wizards/missing', account: 'B' })).status, 404);
  await profile(env, false, 1);
  for (const route of [WIZARD, WIZARD + '/notes/' + publicNote.id]) assert.equal((await call(env, { route, account: 'B' })).status, 404);
  assert.equal((await call(env, { route: WIZARD })).body.profile.visible, false);
});

test('featured-note cap is atomic for creates and updates while editing an already featured note remains possible', async t => {
  const env = fixture(t);
  const first = [];
  for (let n = 0; n < 5; n++) first.push(await createNote(env, { title: 'Vystavená ' + n, visibility: 'public', featured: true }));
  const attempts = await Promise.all([1, 2].map(n => call(env, { route: NOTES, method: 'POST', body: note({ title: 'Súbeh ' + n, visibility: 'public', featured: true }) })));
  assert.deepEqual(attempts.map(r => r.status).sort(), [201, 422]);
  assert.equal(env.DB.sqlite.prepare("SELECT count(*) n FROM calendar_notes WHERE account_id='A' AND featured=1").get().n, 6);
  const last = await updateNote(env, attempts.find(r => r.status === 201).body.note, { title: 'Úprava šiestej' });
  assert.equal(last.featured, true);
  const candidates = [await createNote(env, { visibility: 'public' }), await createNote(env, { visibility: 'public' })];
  assert.equal((await call(env, { route: NOTES + '/' + candidates[0].id, method: 'PUT', body: note({ expectedRevision: 1, visibility: 'public', featured: true }) })).status, 422);
  await updateNote(env, first[0], { visibility: 'private' });
  const updates = await Promise.all(candidates.map(n => call(env, { route: NOTES + '/' + n.id, method: 'PUT', body: note({ expectedRevision: 1, visibility: 'public', featured: true }) })));
  assert.deepEqual(updates.map(r => r.status).sort(), [200, 422]);
  assert.equal((await createNote(env, { visibility: 'public', featured: true }, 'B')).featured, true);
});

test('public pages expose only bounded projections and stable public-note pagination', async t => {
  const env = fixture(t); await profile(env);
  const insert = env.DB.sqlite.prepare('INSERT INTO calendar_notes(id,account_id,date,title,text,pins,visibility,featured,revision,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
  for (let n = 0; n < 25; n++) insert.run('note-' + String(n).padStart(2, '0'), 'A', '2026-10-19', 'Názov ' + n, '<script>plain text</script>\n\t' + 'ž'.repeat(500), '["bank"]', 'public', n < 3 ? 1 : 0, 1, n);
  await createNote(env, { title: 'Súkromný názov', text: 'Súkromný obsah' });
  const first = (await call(env, { route: WIZARD, account: 'B' })).body;
  assert.equal(first.notes.length, 20); assert.equal(first.nextOffset, 20); assert.equal(first.featuredNotes.length, 3);
  assert.deepEqual(first.notes.slice(0, 3).map(n => n.id), ['note-02', 'note-01', 'note-00']);
  assert.ok(first.notes.every(n => n.excerpt.length <= 240 && !n.excerpt.includes('\n') && n.title !== 'Súkromný názov'));
  assert.ok(first.notes[0].excerpt.startsWith('<script>plain text</script> '));
  const second = (await call(env, { route: WIZARD + '?offset=20', account: 'B' })).body;
  assert.equal(second.notes.length, 5); assert.equal(second.nextOffset, null);
  assert.equal(new Set([...first.notes, ...second.notes].map(n => n.id)).size, 25);
  for (const offset of ['-1', '1.2', '1001', '01', '1e2', 'bad']) assert.equal((await call(env, { route: WIZARD + '?offset=' + offset, account: 'B' })).status, 400);
  assert.deepEqual((await call(env, { route: WIZARD + '?offset=1000', account: 'B' })).body.notes, []);
});

test('write guards, body bounds and privacy-field validation reject malformed or forged mutations', async t => {
  const env = fixture(t);
  for (const options of [{ noCsrf: true }, { origin: 'https://attacker.example' }, { header: '0' }]) assert.equal((await call(env, { method: 'PUT', body: { quoteIds: [], expectedRevision: 0 }, ...options })).status, 403);
  assert.equal((await call(env, { method: 'PUT', contentType: 'text/plain', body: { quoteIds: [], expectedRevision: 0 } })).status, 415);
  assert.equal((await call(env, { method: 'PUT', rawBody: 'x'.repeat(4097) })).status, 413);
  for (const rawBody of ['{', '[]', 'null']) assert.equal((await call(env, { method: 'PUT', rawBody })).status, 400);
  for (const changes of [{ visibility: true }, { visibility: 'friends' }, { featured: 1 }, { featured: 'false' }, { title: '\u0000' }, { text: 'x'.repeat(20001) }]) assert.equal((await call(env, { route: NOTES, method: 'POST', body: note(changes) })).status, 422);
  assert.equal((await call(env, { route: NOTES, method: 'POST', rawBody: 'x'.repeat(100 * 1024 + 1) })).status, 413);
  assert.equal((await call(env, { route: WIZARD, method: 'PUT', body: { visible: true } })).status, 405);
  assert.equal(await handleShowcase(request({ route: '/api/social/hall' }), env), null);
});
