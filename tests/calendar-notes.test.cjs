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
const { handleCalendarNotes } = load('calendar-notes', { './auth': auth });
const hash = value => createHash('sha256').update(value).digest('hex');
class Statement {
  constructor(db, sql, values = []) { this.db = db; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.db, this.sql, values); }
  async first() { return this.db.sqlite.prepare(this.sql).get(...this.values) || null; }
  async all() { return { success: true, results: this.db.sqlite.prepare(this.sql).all(...this.values) }; }
  async run() { const result = this.db.sqlite.prepare(this.sql).run(...this.values); return { success: true, results: [], meta: { changes: Number(result.changes) } }; }
}
class TestD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys=ON');
    const folder = path.resolve(__dirname, '../drizzle');
    for (const name of fs.readdirSync(folder).filter(name => name.endsWith('.sql')).sort()) this.sqlite.exec(fs.readFileSync(path.join(folder, name), 'utf8'));
    for (const table of ['calendar_notes', 'calendar_birthdays']) assert.ok(this.sqlite.prepare('SELECT name FROM sqlite_master WHERE name=?').get(table), 'Generate the calendar notes migration before running integration tests.');
  }
  prepare(sql) { return new Statement(this, sql); }
}
function fixture(t) {
  const env = { DB: new TestD1(), BUCKET: {} };
  t.after(() => env.DB.sqlite.close());
  for (const id of ['A', 'B']) {
    env.DB.sqlite.prepare('INSERT INTO wizard_accounts(id,owner_id,normalized_name,display_name,password_hash,created_at) VALUES(?,?,?,?,?,?)').run(id, 'owner-' + id, 'wizard-' + id, 'Čarodej ' + id, 'unused', Date.now());
    env.DB.sqlite.prepare('INSERT INTO wizard_sessions(token_hash,account_id,owner_id,csrf_value,expires_at) VALUES(?,?,?,?,?)').run(hash(hash('session-' + id)), id, 'owner-' + id, hash('csrf-' + id), Date.now() + 86400000);
  }
  return env;
}
const NOTES = '/api/calendar/notes';
const BIRTHDAYS = '/api/calendar/birthdays';
const RANGE = '?from=2026-10-01&to=2026-10-31';
function note(overrides = {}) { return { date: '2026-10-19', title: 'Nápad dňa', text: 'Založiť si sporiaci plán.\nPrečítať knihu.', pins: ['calendar', 'bank', 'library'], ...overrides }; }
function birthday(overrides = {}) { return { name: 'Peter', month: 10, day: 19, year: 1990, ...overrides }; }
function request(options = {}) {
  const { account = 'A', route = NOTES + RANGE, method = 'GET', body, noSession, noOwner, owner, noCsrf, origin = 'https://game.example', header = '1', contentType = 'application/json' } = options;
  const headers = { 'oai-authenticated-user-id': owner ?? ('owner-' + account), Cookie: '__Host-mo-session=' + hash('session-' + account) };
  if (noSession) delete headers.Cookie;
  if (noOwner) delete headers['oai-authenticated-user-id'];
  if (method !== 'GET') Object.assign(headers, { Origin: origin, 'Content-Type': contentType, 'X-MO-Request': header, 'X-MO-CSRF': noCsrf ? '' : hash('csrf-' + account) });
  return new Request('https://game.example' + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function call(env, options = {}) {
  const response = await handleCalendarNotes(request(options), env);
  assert.ok(response);
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function createNote(env, overrides = {}, options = {}) {
  const result = await call(env, { route: NOTES, method: 'POST', body: note(overrides), ...options });
  assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body.note;
}
async function createBirthday(env, overrides = {}, options = {}) {
  const result = await call(env, { route: BIRTHDAYS, method: 'POST', body: birthday(overrides), ...options });
  assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body.birthday;
}

test('day notes and annual birthdays are private to the wizard account and never trust ownership fields', async t => {
  const env = fixture(t);
  const savedNote = await createNote(env, { accountId: 'B', ownerId: 'owner-B', id: 'supplied-id' });
  const savedBirthday = await createBirthday(env, { accountId: 'B', ownerId: 'owner-B', id: 'supplied-id' });
  assert.notEqual(savedNote.id, 'supplied-id'); assert.notEqual(savedBirthday.id, 'supplied-id');
  assert.deepEqual((await call(env)).body.notes, [savedNote]);
  assert.deepEqual((await call(env, { route: BIRTHDAYS })).body.birthdays, [savedBirthday]);
  assert.deepEqual((await call(env, { account: 'B', route: NOTES + RANGE + '&accountId=A' })).body.notes, []);
  assert.deepEqual((await call(env, { account: 'B', route: NOTES + '?section=bank&accountId=A' })).body.notes, []);
  assert.deepEqual((await call(env, { account: 'B', route: BIRTHDAYS + '?accountId=A' })).body.birthdays, []);
  for (const [base, saved, body] of [[NOTES, savedNote, note()], [BIRTHDAYS, savedBirthday, birthday()]]) {
    for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await call(env, { account: 'B', route: base + '/' + saved.id, method, body: method === 'GET' ? undefined : { ...body, expectedRevision: 1 } })).status, 404);
    assert.equal(saved.revision, 1); assert.equal(typeof saved.updatedAt, 'number'); assert.equal('accountId' in saved, false);
    assert.match((await call(env, { route: base + '/' + saved.id })).headers.get('Cache-Control'), /no-store/);
  }
});

test('all note and birthday reads require trusted identity and all writes require same-origin CSRF', async t => {
  const env = fixture(t), savedNote = await createNote(env), savedBirthday = await createBirthday(env);
  for (const [base, saved, fields] of [[NOTES, savedNote, note()], [BIRTHDAYS, savedBirthday, birthday()]]) {
    for (const options of [{ noOwner: true }, { noSession: true }, { owner: 'owner-B' }]) {
      assert.equal((await call(env, { route: base + '/' + saved.id, ...options })).status, 401);
      assert.equal((await call(env, { route: base, method: 'POST', body: fields, ...options })).status, 401);
    }
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const route = base + (method === 'POST' ? '' : '/' + saved.id), body = { ...fields, expectedRevision: 1 };
      for (const options of [{ noCsrf: true }, { origin: 'https://attacker.example' }, { header: '0' }]) assert.equal((await call(env, { route, method, body, ...options })).status, 403);
      assert.equal((await call(env, { route, method, body, contentType: 'text/plain' })).status, 415);
    }
  }
  for (const route of ['/api/calendar/events', '/api/calendar/days', '/api/desk', '/api/calendar/notebook']) assert.equal(await handleCalendarNotes(request({ route }), env), null);
});

test('notes support real calendar dates and validated pins in every building and section', async t => {
  const env = fixture(t);
  const views = ['village', 'library', 'gym', 'meditation', 'gallery', 'farm', 'shop', 'challenges', 'bank', 'calendar', 'profile', 'settings', 'academy', 'workspace', 'quotes', 'desk', 'study', 'notes', 'hall', 'mail'];
  const saved = await createNote(env, { date: '2000-02-29', pins: views, title: '  Tlačený text  ', text: '<script>obyčajný text</script>\n\tĎalší riadok' });
  assert.equal(saved.title, 'Tlačený text'); assert.equal(saved.text, '<script>obyčajný text</script>\n\tĎalší riadok');
  assert.deepEqual(saved.pins, views);
  for (const section of views) assert.deepEqual((await call(env, { route: NOTES + '?section=' + section })).body.notes.map(n => n.id), [saved.id]);
  for (const date of ['1899-12-31', '2101-01-01', '1900-02-29', '2100-02-29', '2026-02-29', '2026-04-31', '2026-0-01', '2026-10-19T00:00:00Z']) assert.equal((await call(env, { route: NOTES, method: 'POST', body: note({ date }) })).status, 422, date);
  for (const pins of [['bank', 'bank'], ['unknown'], ['Bank'], ['bank ', 'library'], [null], 'bank', {}, Array(19).fill('bank')]) assert.equal((await call(env, { route: NOTES, method: 'POST', body: note({ pins }) })).status, 422, JSON.stringify(pins));
  for (const changes of [{ title: 'x'.repeat(161) }, { title: '\u0000' }, { text: 'x'.repeat(20001) }, { text: '\u007f' }, { title: '', text: ' \n\t' }]) assert.equal((await call(env, { route: NOTES, method: 'POST', body: note(changes) })).status, 422);
  assert.equal((await createNote(env, { title: '', text: 'Len text', pins: undefined })).title, '');
  assert.deepEqual((await createNote(env, { text: '', title: 'Len nadpis', pins: undefined })).pins, []);
  assert.equal((await createNote(env, { text: 'ž'.repeat(20000) })).text.length, 20000);
  assert.equal((await call(env, { route: NOTES, method: 'POST', body: note({ surplus: 'x'.repeat(103000) }) })).status, 413);
});

test('notes list only the selected day range or exact pinned section and reject ambiguous unbounded queries', async t => {
  const env = fixture(t);
  const first = await createNote(env, { date: '2026-10-01', pins: ['bank'] });
  const last = await createNote(env, { date: '2026-10-31', pins: ['desk'] });
  const outside = await createNote(env, { date: '2026-11-01', pins: ['bank'] });
  assert.deepEqual((await call(env)).body.notes.map(n => n.id), [first.id, last.id]);
  assert.deepEqual((await call(env, { route: NOTES + '?from=2026-10-31&to=2026-10-31' })).body.notes.map(n => n.id), [last.id]);
  assert.deepEqual((await call(env, { route: NOTES + '?section=bank' })).body.notes.map(n => n.id), [outside.id, first.id]);
  assert.deepEqual((await call(env, { route: NOTES + '?section=gym' })).body.notes, []);
  for (const query of ['', '?from=2026-10-01', '?from=2026-11-01&to=2026-10-01', '?from=2026-02-29&to=2026-10-31', '?from=2024-01-01&to=2025-01-05', '?section=invalid', '?section=', '?section=bank&from=2026-10-01&to=2026-10-31']) assert.equal((await call(env, { route: NOTES + query })).status, 400, query);
  assert.equal((await call(env, { route: NOTES + '?from=2024-01-01&to=2025-01-04' })).status, 200);
});

test('note editors use revision checks and cannot overwrite a concurrent editor or change account ownership', async t => {
  const env = fixture(t), saved = await createNote(env), route = NOTES + '/' + saved.id;
  for (const expectedRevision of [0, -1, 1.5, '1', null, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1]) assert.equal((await call(env, { route, method: 'PUT', body: { ...note(), expectedRevision } })).status, 422);
  const edits = await Promise.all(['Prvá úprava', 'Druhá úprava'].map(title => call(env, { route, method: 'PUT', body: { ...note({ title, date: '2026-11-02', pins: ['study'] }), accountId: 'B', expectedRevision: 1 } })));
  assert.deepEqual(edits.map(r => r.status).sort(), [200, 409]);
  const latest = (await call(env, { route })).body.note;
  assert.equal(latest.revision, 2); assert.equal(latest.date, '2026-11-02'); assert.deepEqual(latest.pins, ['study']);
  assert.equal((await call(env, { route, method: 'DELETE', body: { expectedRevision: 1 } })).status, 409);
  assert.equal((await call(env, { route, method: 'DELETE', body: { expectedRevision: 2 } })).status, 200);
  assert.equal((await call(env, { route })).status, 404);
  assert.deepEqual((await call(env, { account: 'B', route: NOTES + '?section=study' })).body.notes, []);
});

test('annual birthday dates allow an unknown birth year and leap day but reject impossible dates', async t => {
  const env = fixture(t);
  const leap = await createBirthday(env, { name: '  Priestupný oslávenec  ', month: 2, day: 29, year: null });
  assert.equal(leap.name, 'Priestupný oslávenec'); assert.equal(leap.year, null);
  assert.equal((await createBirthday(env, { month: 2, day: 29, year: 2000 })).year, 2000);
  assert.equal((await createBirthday(env, { year: undefined })).year, null);
  for (const changes of [{ name: '' }, { name: ' \n' }, { name: 'x'.repeat(161) }, { name: '\u0000' }, { month: 0 }, { month: 13 }, { month: 1.5 }, { month: '1' }, { day: 0 }, { day: 32 }, { day: 1.5 }, { day: '19' }, { month: 4, day: 31 }, { month: 2, day: 30, year: null }, { month: 2, day: 29, year: 1900 }, { month: 2, day: 29, year: 2026 }, { month: 2, day: 29, year: 2100 }, { year: 1899 }, { year: 2101 }, { year: 2000.5 }, { year: '1990' }]) assert.equal((await call(env, { route: BIRTHDAYS, method: 'POST', body: birthday(changes) })).status, 422, JSON.stringify(changes));
  const annual = (await call(env, { route: BIRTHDAYS })).body.birthdays;
  assert.equal(annual.length, 3); assert.ok(annual.every(item => !('date' in item)), 'Birthdays retain month/day and repeat yearly instead of being fixed one-off events.');
});

test('birthdays sort by month and day and support revisioned edit and deletion', async t => {
  const env = fixture(t);
  const winter = await createBirthday(env, { month: 1, day: 2, name: 'Zima' });
  const summer = await createBirthday(env, { month: 7, day: 12, name: 'Leto' });
  const spring = await createBirthday(env, { month: 4, day: 12, name: 'Jar' });
  assert.deepEqual((await call(env, { route: BIRTHDAYS })).body.birthdays.map(b => b.id), [winter.id, spring.id, summer.id]);
  const route = BIRTHDAYS + '/' + spring.id;
  for (const expectedRevision of [0, -1, 1.2, null, '1', Number.MAX_SAFE_INTEGER]) assert.equal((await call(env, { route, method: 'DELETE', body: { expectedRevision } })).status, 422);
  const edits = await Promise.all(['Prvá', 'Druhá'].map(name => call(env, { route, method: 'PUT', body: { ...birthday({ name, month: 2, day: 29, year: null }), expectedRevision: 1 } })));
  assert.deepEqual(edits.map(r => r.status).sort(), [200, 409]);
  const latest = (await call(env, { route })).body.birthday;
  assert.equal(latest.revision, 2); assert.equal(latest.month, 2); assert.equal(latest.day, 29); assert.equal(latest.year, null);
  assert.equal((await call(env, { route, method: 'DELETE', body: { expectedRevision: 1 } })).status, 409);
  assert.equal((await call(env, { route, method: 'DELETE', body: { expectedRevision: 2 } })).status, 200);
  assert.equal((await call(env, { route })).status, 404);
});

function seedNotes(env, count, account = 'A') {
  const insert = env.DB.sqlite.prepare('INSERT INTO calendar_notes(id,account_id,date,title,text,pins,revision,updated_at) VALUES(?,?,?,?,?,?,1,1)');
  for (let n = 0; n < count; n++) insert.run(account + '-note-' + n, account, '2026-10-19', 'Poznámka ' + n, '', '["bank"]');
}
function seedBirthdays(env, count, account = 'A') {
  const insert = env.DB.sqlite.prepare('INSERT INTO calendar_birthdays(id,account_id,name,month,day,year,revision,updated_at) VALUES(?,?,?,1,1,NULL,1,1)');
  for (let n = 0; n < count; n++) insert.run(account + '-birthday-' + n, account, 'Oslávenec ' + n);
}
test('account limits are atomic during competing creates and do not hide pinned notes or affect other accounts', async t => {
  const env = fixture(t);
  seedNotes(env, 999); seedBirthdays(env, 499);
  const noteCreates = await Promise.all([1, 2].map(n => call(env, { route: NOTES, method: 'POST', body: note({ title: 'Nová ' + n }) })));
  const birthdayCreates = await Promise.all([1, 2].map(n => call(env, { route: BIRTHDAYS, method: 'POST', body: birthday({ name: 'Nový ' + n }) })));
  assert.deepEqual(noteCreates.map(r => r.status).sort(), [201, 422]);
  assert.deepEqual(birthdayCreates.map(r => r.status).sort(), [201, 422]);
  const notes = await call(env, { route: NOTES + '?section=bank' });
  assert.equal(notes.body.notes.length, 1000); assert.equal(notes.body.truncated, false);
  assert.equal((await call(env, { route: BIRTHDAYS })).body.birthdays.length, 500);
  await createNote(env, {}, { account: 'B' }); await createBirthday(env, {}, { account: 'B' });
  assert.equal((await call(env, { route: NOTES + '/A-note-0', method: 'DELETE', body: { expectedRevision: 1 } })).status, 200);
  assert.equal((await call(env, { route: BIRTHDAYS + '/A-birthday-0', method: 'DELETE', body: { expectedRevision: 1 } })).status, 200);
  await createNote(env); await createBirthday(env);
});

test('deleting a wizard account removes its notes and birthdays and preserves the other wizard', async t => {
  const env = fixture(t);
  await createNote(env); await createBirthday(env);
  const otherNote = await createNote(env, {}, { account: 'B' }), otherBirthday = await createBirthday(env, {}, { account: 'B' });
  env.DB.sqlite.prepare('DELETE FROM wizard_accounts WHERE id=?').run('A');
  for (const table of ['calendar_notes', 'calendar_birthdays']) assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM ' + table + ' WHERE account_id=?').get('A').n, 0);
  assert.deepEqual((await call(env, { account: 'B' })).body.notes, [otherNote]);
  assert.deepEqual((await call(env, { account: 'B', route: BIRTHDAYS })).body.birthdays, [otherBirthday]);
});
