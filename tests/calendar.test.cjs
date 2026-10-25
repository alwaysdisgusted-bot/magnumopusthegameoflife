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
const { handleCalendar } = load('calendar', { './auth': auth });
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
    assert.ok(this.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='calendar_events'").get(), 'Generate the calendar migration before running integration tests.');
  }
  prepare(sql) { return new Statement(this, sql); }
  async batch(statements) {
    this.batchSizes = this.batchSizes || []; this.batchSizes.push(statements.length);
    const number = this.batchSizes.length, results = [];
    this.sqlite.exec('BEGIN');
    try {
      for (const [index, statement] of statements.entries()) {
        if (this.failBatchNumber === number && index === (this.failBatchStatement || 0)) { this.failBatchNumber = null; throw new Error('Injected batch failure'); }
        const result = this.sqlite.prepare(statement.sql).run(...statement.values);
        results.push({ success: true, results: [], meta: { changes: Number(result.changes) } });
      }
      this.sqlite.exec('COMMIT');
      if (this.failAfterBatchNumber === number) { this.failAfterBatchNumber = null; throw new Error('Transport failed after batch commit'); }
      return results;
    } catch (error) {
      if (this.sqlite.isTransaction) this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}
function fixture(t) {
  const env = { DB: new TestD1(), BUCKET: {} };
  t.after(() => env.DB.sqlite.close());
  for (const id of ['A', 'B']) {
    env.DB.sqlite.prepare('INSERT INTO wizard_accounts(id,owner_id,normalized_name,display_name,password_hash,created_at) VALUES(?,?,?,?,?,?)').run(id, 'owner-' + id, 'wizard-' + id, 'Čarodej ' + id, 'not-used', Date.now());
    env.DB.sqlite.prepare('INSERT INTO wizard_sessions(token_hash,account_id,owner_id,csrf_value,expires_at) VALUES(?,?,?,?,?)').run(hash(hash('session-' + id)), id, 'owner-' + id, hash('csrf-' + id), Date.now() + 86400000);
  }
  return env;
}
const BASE = '/api/calendar/events';
const RANGE = '?from=2026-10-01&to=2026-10-31';
function event(overrides = {}) { return { title: 'Čas pre seba', description: 'Prečítať dvadsať strán.', date: '2026-10-18', time: '17:30', color: '#D57C9F', completed: false, ...overrides }; }
function request(options = {}) {
  const { account = 'A', route = BASE + RANGE, method = 'GET', body, noSession, noOwner, owner, noCsrf, origin = 'https://game.example', header = '1', contentType = 'application/json' } = options;
  const headers = { 'oai-authenticated-user-id': owner ?? ('owner-' + account), Cookie: '__Host-mo-session=' + hash('session-' + account) };
  if (noSession) delete headers.Cookie;
  if (noOwner) delete headers['oai-authenticated-user-id'];
  if (method !== 'GET') Object.assign(headers, { Origin: origin, 'Content-Type': contentType, 'X-MO-Request': header, 'X-MO-CSRF': noCsrf ? '' : hash('csrf-' + account) });
  return new Request('https://game.example' + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function call(env, options = {}) {
  const response = await handleCalendar(request(options), env);
  assert.ok(response);
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function create(env, overrides = {}, options = {}) {
  const result = await call(env, { route: BASE, method: 'POST', body: event(overrides), ...options });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body.event;
}

test('calendar events belong only to the authenticated account, ignoring supplied ownership fields', async t => {
  const env = fixture(t);
  assert.deepEqual((await call(env)).body.events, []);
  const created = await create(env, { accountId: 'B', ownerId: 'owner-B', id: 'stolen-id' });
  assert.notEqual(created.id, 'stolen-id');
  assert.equal(created.revision, 1);
  assert.equal(typeof created.updatedAt, 'number');
  assert.deepEqual((await call(env, { account: 'B', route: BASE + RANGE + '&accountId=A' })).body.events, []);
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const result = await call(env, { account: 'B', route: BASE + '/' + created.id, method, body: method === 'GET' ? undefined : { ...event(), expectedRevision: 1 } });
    assert.equal(result.status, 404);
  }
  assert.equal(env.DB.sqlite.prepare('SELECT account_id FROM calendar_events WHERE id=?').get(created.id).account_id, 'A');
  const personal = await call(env);
  assert.deepEqual(personal.body.events, [created]);
  assert.match(personal.headers.get('Cache-Control'), /no-store/);
  assert.equal('accountId' in created, false);
});

test('all reads require trusted identity and a session; writes require Origin, CSRF and JSON headers', async t => {
  const env = fixture(t);
  for (const options of [{ noOwner: true }, { noSession: true }, { owner: 'owner-B' }]) {
    assert.equal((await call(env, options)).status, 401);
    assert.equal((await call(env, { route: BASE, method: 'POST', body: event(), ...options })).status, 401);
  }
  const created = await create(env);
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const route = method === 'POST' ? BASE : BASE + '/' + created.id;
    const body = { ...event(), expectedRevision: 1 };
    for (const options of [{ noCsrf: true }, { origin: 'https://attacker.example' }, { header: '0' }]) assert.equal((await call(env, { route, method, body, ...options })).status, 403);
    assert.equal((await call(env, { route, method, body, contentType: 'text/plain' })).status, 415);
  }
  assert.equal((await call(env)).body.events.length, 1);
  assert.equal(await handleCalendar(request({ route: '/api/something-else' }), env), null);
});

test('date ranges are inclusive, validated and limited to at most 370 calendar days', async t => {
  const env = fixture(t);
  const first = await create(env, { title: 'Prvý deň', date: '2026-10-01', time: '' });
  const last = await create(env, { title: 'Posledný deň', date: '2026-10-31', time: '' });
  await create(env, { title: 'Mimo rozsahu', date: '2026-11-01' });
  assert.deepEqual((await call(env)).body.events.map(e => e.id), [first.id, last.id]);
  const oneDay = await call(env, { route: BASE + '?from=2026-10-31&to=2026-10-31' });
  assert.deepEqual(oneDay.body.events.map(e => e.id), [last.id]);
  for (const query of ['', '?from=2026-10-01', '?from=2026-11-01&to=2026-10-01', '?from=2026-02-29&to=2026-10-01', '?from=2024-01-01&to=2025-01-05', '?from=1899-12-31&to=1900-01-01', '?from=2026-1-01&to=2026-01-31']) assert.equal((await call(env, { route: BASE + query })).status, 400, query);
  assert.equal((await call(env, { route: BASE + '?from=2024-01-01&to=2025-01-04' })).status, 200);
});

test('Gregorian dates, time, text lengths and colors are validated without changing existing records', async t => {
  const env = fixture(t);
  for (const date of ['1900-02-29', '2100-02-29', '2026-04-31', '2026-00-01', '2026-12-00', '2201-01-01', '2026-10-18T00:00:00Z']) assert.equal((await call(env, { route: BASE, method: 'POST', body: event({ date }) })).status, 422, date);
  for (const changes of [{ title: '' }, { title: ' ' }, { title: 'x'.repeat(161) }, { description: 'x'.repeat(4001) }, { description: '\u0000' }, { time: '24:00' }, { time: '9:30' }, { time: '12:60' }, { color: 'red' }, { color: '#fff' }, { completed: 1 }]) assert.equal((await call(env, { route: BASE, method: 'POST', body: event(changes) })).status, 422, JSON.stringify(changes));
  const leap = await create(env, { date: '2000-02-29', time: '00:00', title: '  Priestupný rok  ', description: '<script>len obyčajný text</script>\nPoznámka.' });
  assert.equal(leap.title, 'Priestupný rok');
  assert.equal(leap.description, '<script>len obyčajný text</script>\nPoznámka.');
  const end = await create(env, { date: '2200-12-31', time: '23:59' });
  assert.equal(end.date, '2200-12-31');
  const defaults = await call(env, { route: BASE, method: 'POST', body: { title: 'Celý deň', date: '1900-01-01' } });
  assert.equal(defaults.status, 201);
  assert.equal(defaults.body.event.time, '');
  assert.equal(defaults.body.event.description, '');
  assert.equal(defaults.body.event.completed, false);
});

test('edits and deletion require the current revision and cannot reassign ownership', async t => {
  const env = fixture(t), created = await create(env), route = BASE + '/' + created.id;
  for (const expectedRevision of [0, -1, '1', null, 1.5, Number.MAX_SAFE_INTEGER]) assert.equal((await call(env, { route, method: 'PUT', body: { ...event(), expectedRevision } })).status, 422);
  const updated = await call(env, { route, method: 'PUT', body: { ...event({ title: 'Dokončené', completed: true }), accountId: 'B', expectedRevision: 1 } });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.event.revision, 2);
  assert.equal(updated.body.event.completed, true);
  assert.equal((await call(env, { route, method: 'PUT', body: { ...event(), expectedRevision: 1 } })).status, 409);
  assert.equal((await call(env, { route, method: 'DELETE', body: { expectedRevision: 1 } })).status, 409);
  assert.equal((await call(env, { route })).body.event.title, 'Dokončené');
  assert.equal((await call(env, { route, method: 'DELETE', body: { expectedRevision: 2 } })).status, 200);
  assert.equal((await call(env, { route })).status, 404);
  assert.deepEqual((await call(env)).body.events, []);
});

test('concurrent event editors cannot overwrite each other', async t => {
  const env = fixture(t), created = await create(env), route = BASE + '/' + created.id;
  const results = await Promise.all(['ľavá', 'pravá'].map(title => call(env, { route, method: 'PUT', body: { ...event({ title }), expectedRevision: 1 } })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const latest = (await call(env, { route })).body.event;
  assert.equal(latest.revision, 2);
  assert.ok(['ľavá', 'pravá'].includes(latest.title));
});

test('events sort by date and local time and are deleted when the owning account is removed', async t => {
  const env = fixture(t);
  await create(env, { title: 'Večer', time: '20:00' });
  await create(env, { title: 'Celý deň', time: '' });
  await create(env, { title: 'Ráno', time: '06:00' });
  await create(env, { title: 'Iný účet' }, { account: 'B' });
  assert.deepEqual((await call(env)).body.events.map(e => e.title), ['Celý deň', 'Ráno', 'Večer']);
  env.DB.sqlite.prepare('DELETE FROM wizard_accounts WHERE id=?').run('A');
  assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM calendar_events WHERE account_id=?').get('A').n, 0);
  assert.equal((await call(env, { account: 'B' })).body.events.length, 1);
});

const DAYS = '/api/calendar/days';
function setDay(env, date, type, expectedRevision = 0, options = {}) { return call(env, { route: DAYS + '/' + date, method: 'PUT', body: { type, expectedRevision }, ...options }); }
function days(env, options = {}) { return call(env, { route: DAYS + RANGE, ...options }); }
function backup(env, options = {}) { return call(env, { route: '/api/calendar/backup', ...options }); }
function importDays(env, data, options = {}) { return call(env, { route: '/api/calendar/import', method: 'POST', body: data, ...options }); }
function storedDays(env, account = 'A') { return env.DB.sqlite.prepare('SELECT date,type,revision FROM calendar_days WHERE account_id=? ORDER BY date').all(account); }

test('day types use revisioned updates and preserve a cleared day as a tombstone', async t => {
  const env = fixture(t), date = '2026-10-18';
  assert.deepEqual((await days(env)).body.days, []);
  const types = ['work8', 'work12', 'school', 'free', ''];
  for (const [index, type] of types.entries()) {
    const result = await setDay(env, date, type, index);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.day.date, date); assert.equal(result.body.day.type, type); assert.equal(result.body.day.revision, index + 1); assert.equal(typeof result.body.day.updatedAt, 'number');
  }
  const cleared = (await days(env)).body.days[0];
  assert.equal(cleared.type, ''); assert.equal(cleared.revision, 5);
  assert.deepEqual((await backup(env)).body, { version: 2, days: {} });
  assert.equal((await setDay(env, date, 'work8', 0)).status, 409);
  assert.equal((await setDay(env, date, 'work8', 1)).status, 409);
  assert.deepEqual((await days(env)).body.days, [cleared]);
  assert.equal((await setDay(env, date, 'free', 5)).body.day.revision, 6);
  assert.deepEqual((await backup(env)).body.days, { [date]: 'free' });
});

test('day revisions, supported types, real dates and bounded ranges are validated without writes', async t => {
  const env = fixture(t), date = '2026-10-18';
  for (const revision of [-1, 0.5, '0', null, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1]) assert.equal((await setDay(env, date, 'free', revision)).status, 422, String(revision));
  for (const type of ['work7', 'Work8', ' free', 'free ', null, 0, false, {}, []]) assert.equal((await setDay(env, date, type)).status, 422, JSON.stringify(type));
  for (const invalid of ['2026-02-29', '1900-02-29', '2100-02-29', '2026-04-31', '2026-00-01', '2026-12-00', '1899-12-31', '2201-01-01']) assert.equal((await setDay(env, invalid, 'school')).status, 422, invalid);
  assert.deepEqual(storedDays(env), []);
  for (const query of ['', '?from=2026-10-01', '?from=2026-11-01&to=2026-10-01', '?from=2026-02-29&to=2026-10-01', '?from=2024-01-01&to=2025-01-05']) assert.equal((await days(env, { route: DAYS + query })).status, 400, query);
  assert.equal((await days(env, { route: DAYS + '?from=2024-01-01&to=2025-01-04' })).status, 200);
  assert.equal((await setDay(env, '2000-02-29', 'school')).status, 200);
  assert.equal((await setDay(env, '1900-01-01', '')).status, 200);
  assert.equal((await setDay(env, '2200-12-31', 'free')).status, 200);
});

test('concurrent day creation and editing each accept exactly one writer per account and date', async t => {
  const env = fixture(t), date = '2026-10-19';
  for (const revision of [0, 1]) {
    const results = await Promise.all(['work8', 'school'].map(type => setDay(env, date, type, revision)));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const current = (await days(env)).body.days[0]; assert.equal(current.revision, revision + 1); assert.ok(['work8', 'school'].includes(current.type));
  }
  assert.equal((await setDay(env, date, 'free', 0, { account: 'B' })).status, 200);
  assert.equal((await days(env, { account: 'B' })).body.days[0].revision, 1);
  assert.equal((await days(env)).body.days[0].revision, 2);
});

test('day lists and backups expose only their owner and omit cleared days and event contents', async t => {
  const env = fixture(t);
  await setDay(env, '2026-10-18', 'work8'); await setDay(env, '2026-10-17', 'school'); await setDay(env, '2026-10-19', '');
  await setDay(env, '2026-10-18', 'free', 0, { account: 'B' });
  await create(env, { title: 'Súkromná udalosť', description: 'Neprenáša sa do zálohy typov dní.' });
  const result = await backup(env, { route: '/api/calendar/backup?accountId=B&ownerId=owner-B' });
  assert.equal(result.status, 200); assert.match(result.headers.get('Cache-Control'), /no-store/);
  assert.deepEqual(result.body, { version: 2, days: { '2026-10-17': 'school', '2026-10-18': 'work8' } });
  assert.deepEqual((await backup(env, { account: 'B' })).body, { version: 2, days: { '2026-10-18': 'free' } });
  assert.deepEqual((await days(env, { route: DAYS + RANGE + '&accountId=B' })).body.days.map(d => [d.date, d.type]), [['2026-10-17', 'school'], ['2026-10-18', 'work8'], ['2026-10-19', '']]);
  assert.equal(JSON.stringify(result.body).includes('Súkromná'), false); assert.equal('accountId' in result.body, false);
});

test('day, backup and import routes enforce identity, session, CSRF, origin and JSON', async t => {
  const env = fixture(t), legacy = { version: 1, days: { '2026-10-18': 'free' } };
  for (const options of [{ noOwner: true }, { noSession: true }, { owner: 'owner-B' }]) {
    assert.equal((await days(env, options)).status, 401); assert.equal((await backup(env, options)).status, 401);
    assert.equal((await setDay(env, '2026-10-18', 'free', 0, options)).status, 401); assert.equal((await importDays(env, legacy, options)).status, 401);
  }
  for (const options of [{ noCsrf: true }, { origin: 'https://attacker.example' }, { header: '0' }]) {
    assert.equal((await setDay(env, '2026-10-18', 'free', 0, options)).status, 403); assert.equal((await importDays(env, legacy, options)).status, 403);
  }
  assert.equal((await setDay(env, '2026-10-18', 'free', 0, { contentType: 'text/plain' })).status, 415);
  assert.equal((await importDays(env, legacy, { contentType: 'text/plain' })).status, 415);
  assert.deepEqual(storedDays(env), []);
});

test('legacy calendar import merges only unassigned days and is idempotent for versions one and two', async t => {
  const env = fixture(t);
  await setDay(env, '2026-10-01', 'work12'); await setDay(env, '2026-10-02', '');
  const data = { version: 1, days: { '2026-10-01': 'work8', '2026-10-02': 'school', '2026-10-03': 'free', '2026-10-04': 'school' }, accountId: 'B' };
  assert.deepEqual((await importDays(env, data)).body, { imported: 2, skipped: 2 });
  assert.deepEqual(storedDays(env).map(d => [d.date, d.type, d.revision]), [['2026-10-01', 'work12', 1], ['2026-10-02', '', 1], ['2026-10-03', 'free', 1], ['2026-10-04', 'school', 1]]);
  assert.deepEqual((await importDays(env, data)).body, { imported: 0, skipped: 4 });
  const versionTwo = { version: 2, days: { ...data.days, '2026-10-05': 'work12' } };
  assert.deepEqual((await importDays(env, versionTwo)).body, { imported: 1, skipped: 4 });
  assert.deepEqual((await importDays(env, data, { account: 'B' })).body, { imported: 4, skipped: 0 });
  assert.equal(storedDays(env, 'B')[0].type, 'work8');
  assert.deepEqual((await call(env)).body.events, []);
});

test('invalid legacy data is rejected before any portion of its days is imported', async t => {
  const env = fixture(t), valid = { '2026-10-18': 'free' };
  for (const data of [null, [], {}, { version: '1', days: valid }, { version: 3, days: valid }, { version: 1, days: [] }, { version: 1, days: 'text' }, { version: 1, days: { ...valid, '2026-02-29': 'school' } }, { version: 2, days: { ...valid, '2026-10-19': '' } }, { version: 2, days: { ...valid, '2026-10-19': 'work7' } }, { version: 2, days: { ...valid, '2201-01-01': 'work8' } }, { version: 1, days: { ...valid, '2026-10-19': { type: 'school' } } }]) {
    assert.equal((await importDays(env, data)).status, data === null || Array.isArray(data) ? 400 : 422, JSON.stringify(data)); assert.deepEqual(storedDays(env), []);
  }
  assert.deepEqual((await importDays(env, { version: 2, days: {} })).body, { imported: 0, skipped: 0 });
  assert.equal((await importDays(env, { version: 1, days: valid, unused: 'x'.repeat(2 * 1024 * 1024) })).status, 413);
  assert.equal((await importDays(env, { version: 1, days: manyDays(50001) })).status, 422);
  assert.deepEqual(storedDays(env), []);
});

function manyDays(length) { return Object.fromEntries(Array.from({ length }, (_, index) => [new Date(Date.UTC(2000, 0, 1) + index * 86400000).toISOString().slice(0, 10), ['work8', 'work12', 'school', 'free'][index % 4]])); }
test('large legacy imports use bounded transactional batches and count all skipped days accurately', async t => {
  const env = fixture(t), data = { version: 1, days: manyDays(250) };
  assert.deepEqual((await importDays(env, data)).body, { imported: 250, skipped: 0 });
  assert.deepEqual(env.DB.batchSizes, [100, 100, 50]); assert.equal(storedDays(env).length, 250);
  assert.deepEqual((await importDays(env, { ...data, version: 2 })).body, { imported: 0, skipped: 250 });
  assert.deepEqual(env.DB.batchSizes, [100, 100, 50, 100, 100, 50]);
});

test('retrying partial or ambiguous batch failures safely resumes without overwriting user edits', async t => {
  for (const failure of ['midBatch', 'afterCommit']) {
    const env = fixture(t), data = { version: 1, days: manyDays(250) };
    if (failure === 'midBatch') { env.DB.failBatchNumber = 2; env.DB.failBatchStatement = 10; }
    else env.DB.failAfterBatchNumber = 1;
    assert.equal((await importDays(env, data)).status, 503, failure);
    assert.equal(storedDays(env).length, 100, failure);
    assert.equal((await setDay(env, '2000-01-01', 'free', 1)).status, 200);
    assert.deepEqual((await importDays(env, data)).body, { imported: 150, skipped: 100 });
    assert.equal(storedDays(env).length, 250); assert.equal(storedDays(env)[0].type, 'free'); assert.equal(storedDays(env)[0].revision, 2);
  }
});

test('day assignments are removed with their owning account while other calendars survive', async t => {
  const env = fixture(t);
  await setDay(env, '2026-10-18', 'school'); await setDay(env, '2026-10-18', 'free', 0, { account: 'B' });
  env.DB.sqlite.prepare('DELETE FROM wizard_accounts WHERE id=?').run('A');
  assert.deepEqual(storedDays(env), []); assert.equal(storedDays(env, 'B').length, 1);
  assert.deepEqual((await backup(env, { account: 'B' })).body.days, { '2026-10-18': 'free' });
});
