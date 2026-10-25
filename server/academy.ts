import { ApiError, guardWrite, json, readJson, requireAccount, verifyCsrf, type AuthEnv } from './auth';

type Row = Record<string, string | number | null>;
type Input = Record<string, unknown>;
type Account = Awaited<ReturnType<typeof requireAccount>>;
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const statusValues = ['todo', 'doing', 'done'];

function database(env: AuthEnv): D1Database {
  if (!env.DB) throw new ApiError(503, 'storage_unavailable', 'Úložisko je teraz nedostupné. Skús to neskôr.');
  return env.DB;
}
function invalid(message: string): never { throw new ApiError(400, 'invalid_input', message); }
function missing(): never { throw new ApiError(404, 'not_found', 'Táto položka sa nenašla alebo k nej nemáš prístup.'); }
function identifier(value: unknown, label = 'Identifikátor'): string {
  if (typeof value !== 'string' || !ID.test(value)) invalid(label + ' nie je platný.');
  return value;
}
function text(value: unknown, label: string, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) invalid(label + ' musí mať ' + (empty ? 'najviac ' : '1 až ') + max + ' znakov.');
  return empty ? value : value.trim();
}
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) invalid('Pri ukladaní chýba platná verzia záznamu. Obnov stránku.');
  return Number(value);
}
async function input(request: Request): Promise<Input> {
  const body = await readJson(request, 100000);
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Formulár nemá platný formát.');
  return body as Input;
}
function roomId(value: unknown): string | null { return value === null || value === undefined || value === '' ? null : identifier(value, 'Miestnosť'); }
function uid(): string { return crypto.randomUUID(); }
async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function inviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...crypto.getRandomValues(new Uint8Array(16))].map(byte => alphabet[byte & 31]).join('');
}
function mappedRoom(row: Row, accountId: string) {
  return { id: row.id, name: row.name, ownerId: row.owner_account_id, isOwner: row.owner_account_id === accountId, createdAt: row.created_at };
}
function mappedChannel(row: Row) { return { id: row.id, roomId: row.room_id, name: row.name, createdAt: row.created_at }; }
function mappedPage(row: Row) { return { id: row.id, ownerId: row.owner_account_id, roomId: row.room_id, title: row.title, body: row.body, revision: row.revision, updatedAt: row.updated_at }; }
function mappedTask(row: Row) { return { id: row.id, ownerId: row.owner_account_id, roomId: row.room_id, title: row.title, description: row.description, status: row.status, assigneeId: row.assignee_id, revision: row.revision, updatedAt: row.updated_at }; }
async function member(db: D1Database, room: string, accountId: string): Promise<Row> {
  const result = await db.prepare('SELECT r.id, r.name, r.owner_account_id, r.created_at FROM academy_rooms r INNER JOIN academy_members m ON m.room_id = r.id WHERE r.id = ? AND m.account_id = ?').bind(room, accountId).first<Row>();
  if (!result) missing();
  return result;
}
async function channelAccess(db: D1Database, channel: string, accountId: string): Promise<Row> {
  const result = await db.prepare('SELECT c.id, c.room_id, c.name FROM academy_channels c INNER JOIN academy_members m ON m.room_id = c.room_id WHERE c.id = ? AND m.account_id = ?').bind(channel, accountId).first<Row>();
  if (!result) missing();
  return result;
}
async function workspaceAccess(db: D1Database, table: string, item: string, accountId: string): Promise<Row> {
  // Table names are internal constants selected by the router, never user input.
  const result = await db.prepare('SELECT * FROM ' + table + ' WHERE id = ? AND ((room_id IS NULL AND owner_account_id = ?) OR room_id IN (SELECT room_id FROM academy_members WHERE account_id = ?))').bind(item, accountId, accountId).first<Row>();
  if (!result) missing();
  return result;
}
async function verifyAssignee(db: D1Database, room: string | null, value: unknown, accountId: string): Promise<string | null> {
  if (value === null || value === undefined || value === '') return null;
  const assignee = identifier(value, 'Priradený člen');
  if (!room) {
    if (assignee !== accountId) invalid('Osobnú úlohu môžeš priradiť iba sebe.');
  } else {
    const exists = await db.prepare('SELECT account_id FROM academy_members WHERE room_id = ? AND account_id = ?').bind(room, assignee).first();
    if (!exists) invalid('Úlohu môžeš priradiť iba členovi tejto miestnosti.');
  }
  return assignee;
}
async function rateLimitJoin(db: D1Database, accountId: string): Promise<void> {
  const now = Date.now();
  const cutoff = now - 15 * 60 * 1000;
  const attempt = await db.prepare('INSERT INTO academy_join_attempts (account_id, window_start, attempts) VALUES (?, ?, 1) ON CONFLICT(account_id) DO UPDATE SET attempts = CASE WHEN window_start < ? THEN 1 ELSE attempts + 1 END, window_start = CASE WHEN window_start < ? THEN ? ELSE window_start END RETURNING attempts').bind(accountId, now, cutoff, cutoff, now).first<{ attempts: number }>();
  if (!attempt || attempt.attempts > 12) throw new ApiError(429, 'join_rate_limited', 'Priveľa pokusov o vstup. Skús to znovu o 15 minút.');
}
async function workspaceRoute(request: Request, db: D1Database, account: Account, url: URL, kind: string, itemId?: string): Promise<Response> {
  const isPage = kind === 'pages';
  const table = isPage ? 'workspace_pages' : 'workspace_tasks';
  const mapper = isPage ? mappedPage : mappedTask;
  const method = request.method;
  if (!itemId && method === 'GET') {
    const room = roomId(url.searchParams.get('roomId'));
    if (room) await member(db, room, account.accountId);
    const query = room ? 'SELECT * FROM ' + table + ' WHERE room_id = ? ORDER BY updated_at DESC, id DESC LIMIT 500' : 'SELECT * FROM ' + table + ' WHERE owner_account_id = ? AND room_id IS NULL ORDER BY updated_at DESC, id DESC LIMIT 500';
    const rows = await db.prepare(query).bind(room || account.accountId).all<Row>();
    return json({ [kind]: rows.results.map(row => mapper(row)) });
  }
  if (itemId && method === 'GET') return json({ [isPage ? 'page' : 'task']: mapper(await workspaceAccess(db, table, itemId, account.accountId)) });
  const data = await input(request);
  const current = itemId ? await workspaceAccess(db, table, itemId, account.accountId) : null;
  const room = current ? (current.room_id as string | null) : roomId(data.roomId);
  if (room) await member(db, room, account.accountId);
  if (itemId && (method === 'PUT' || method === 'DELETE')) {
    const expected = revision(data.expectedRevision);
    if (current!.revision !== expected) throw new ApiError(409, 'revision_conflict', 'Niekto túto položku práve upravil. Obnov ju a skús zmenu znova.');
    if (method === 'DELETE') {
      const result = await db.prepare('DELETE FROM ' + table + ' WHERE id = ? AND revision = ? AND ((room_id IS NULL AND owner_account_id = ?) OR room_id IN (SELECT room_id FROM academy_members WHERE account_id = ?))').bind(itemId, expected, account.accountId, account.accountId).run();
      if (!result.meta.changes) throw new ApiError(409, 'revision_conflict', 'Položka sa medzitým zmenila. Obnov ju.');
      return json({ deleted: true });
    }
  } else if (itemId || method !== 'POST') throw new ApiError(405, 'method_not_allowed', 'Táto operácia nie je podporovaná.');
  const title = text(data.title, 'Názov', 160);
  const body = text(isPage ? data.body ?? '' : data.description ?? '', isPage ? 'Obsah stránky' : 'Popis úlohy', 20000, true);
  const status = String(data.status ?? 'todo');
  if (!isPage && !statusValues.includes(status)) invalid('Vyber platný stav úlohy.');
  const assignee = isPage ? null : await verifyAssignee(db, room, data.assigneeId, account.accountId);
  const id = itemId || uid();
  const now = new Date().toISOString();
  if (!current) {
    if (isPage) await db.prepare('INSERT INTO workspace_pages (id, owner_account_id, room_id, title, body, revision, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?)').bind(id, account.accountId, room, title, body, now).run();
    else await db.prepare('INSERT INTO workspace_tasks (id, owner_account_id, room_id, title, description, status, assignee_id, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)').bind(id, account.accountId, room, title, body, status, assignee, now).run();
  } else {
    const scope = ' AND ((room_id IS NULL AND owner_account_id = ?) OR room_id IN (SELECT room_id FROM academy_members WHERE account_id = ?))';
    const result = isPage ? await db.prepare('UPDATE workspace_pages SET title = ?, body = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?' + scope).bind(title, body, now, id, revision(data.expectedRevision), account.accountId, account.accountId).run() : await db.prepare('UPDATE workspace_tasks SET title = ?, description = ?, status = ?, assignee_id = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?' + scope).bind(title, body, status, assignee, now, id, revision(data.expectedRevision), account.accountId, account.accountId).run();
    if (!result.meta.changes) throw new ApiError(409, 'revision_conflict', 'Niekto túto položku práve upravil. Obnov ju a skús znova.');
  }
  return json({ [isPage ? 'page' : 'task']: mapper(await workspaceAccess(db, table, id, account.accountId)) }, current ? 200 : 201);
}

export async function handleAcademy(request: Request, env: AuthEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '');
  if (!path.startsWith('/api/academy/') && !path.startsWith('/api/workspace/')) return null;
  try {
    const account = await requireAccount(request, env);
    const db = database(env);
    if (request.method !== 'GET') { guardWrite(request); verifyCsrf(request, account); }
    let match: RegExpMatchArray | null;
    if ((match = path.match(/^\/api\/workspace\/(pages|tasks)(?:\/([a-zA-Z0-9_-]{1,100}))?$/))) return await workspaceRoute(request, db, account, url, match[1], match[2]);
    if (path === '/api/academy/rooms' && request.method === 'GET') {
      const rooms = await db.prepare('SELECT r.id, r.name, r.owner_account_id, r.created_at FROM academy_rooms r INNER JOIN academy_members m ON m.room_id = r.id WHERE m.account_id = ? ORDER BY r.created_at DESC').bind(account.accountId).all<Row>();
      return json({ rooms: rooms.results.map(row => mappedRoom(row, account.accountId)) });
    }
    if (path === '/api/academy/rooms' && request.method === 'POST') {
      const data = await input(request);
      const name = text(data.name, 'Názov miestnosti', 160);
      const code = inviteCode();
      const room = uid();
      const channel = uid();
      const now = new Date().toISOString();
      await db.batch([
        db.prepare('INSERT INTO academy_rooms (id, name, owner_account_id, invite_hash, created_at) VALUES (?, ?, ?, ?, ?)').bind(room, name, account.accountId, await hash(code), now),
        db.prepare('INSERT INTO academy_members (room_id, account_id, joined_at) VALUES (?, ?, ?)').bind(room, account.accountId, now),
        db.prepare('INSERT INTO academy_channels (id, room_id, name, created_at) VALUES (?, ?, ?, ?)').bind(channel, room, 'všeobecne', now),
      ]);
      return json({ room: { id: room, name, ownerId: account.accountId, isOwner: true, createdAt: now }, inviteCode: code }, 201);
    }
    if (path === '/api/academy/rooms/join' && request.method === 'POST') {
      await rateLimitJoin(db, account.accountId);
      const data = await input(request);
      const code = typeof data.code === 'string' ? data.code.replace(/[\s-]/g, '').toUpperCase() : '';
      if (!/^[A-Z2-9]{16}$/.test(code)) throw new ApiError(404, 'invite_invalid', 'Pozývací kód nie je platný.');
      const room = await db.prepare('SELECT id, name, owner_account_id, created_at FROM academy_rooms WHERE invite_hash = ?').bind(await hash(code)).first<Row>();
      if (!room) throw new ApiError(404, 'invite_invalid', 'Pozývací kód nie je platný.');
      await db.prepare('INSERT INTO academy_members (room_id, account_id, joined_at) VALUES (?, ?, ?) ON CONFLICT(room_id, account_id) DO NOTHING').bind(room.id, account.accountId, new Date().toISOString()).run();
      return json({ room: mappedRoom(room, account.accountId) });
    }
    if ((match = path.match(/^\/api\/academy\/rooms\/([a-zA-Z0-9_-]{1,100})\/invite$/)) && request.method === 'POST') {
      const room = await member(db, match[1], account.accountId);
      if (room.owner_account_id !== account.accountId) throw new ApiError(403, 'owner_required', 'Pozývací kód môže obnoviť iba zakladateľ miestnosti.');
      const code = inviteCode();
      await db.prepare('UPDATE academy_rooms SET invite_hash = ? WHERE id = ? AND owner_account_id = ?').bind(await hash(code), room.id, account.accountId).run();
      return json({ inviteCode: code });
    }
    if ((match = path.match(/^\/api\/academy\/rooms\/([a-zA-Z0-9_-]{1,100})\/members$/)) && request.method === 'GET') {
      await member(db, match[1], account.accountId);
      const members = await db.prepare('SELECT m.account_id AS id, a.display_name AS name, m.joined_at FROM academy_members m INNER JOIN wizard_accounts a ON a.id = m.account_id WHERE m.room_id = ? ORDER BY m.joined_at, a.display_name').bind(match[1]).all<Row>();
      return json({ members: members.results.map(row => ({ id: row.id, name: row.name, joinedAt: row.joined_at })) });
    }
    if ((match = path.match(/^\/api\/academy\/rooms\/([a-zA-Z0-9_-]{1,100})\/channels$/))) {
      await member(db, match[1], account.accountId);
      if (request.method === 'GET') {
        const channels = await db.prepare('SELECT id, room_id, name, created_at FROM academy_channels WHERE room_id = ? ORDER BY created_at, id').bind(match[1]).all<Row>();
        return json({ channels: channels.results.map(mappedChannel) });
      }
      if (request.method === 'POST') {
        const data = await input(request);
        const name = text(data.name, 'Názov kanála', 80);
        const id = uid();
        const now = new Date().toISOString();
        await db.prepare('INSERT INTO academy_channels (id, room_id, name, created_at) VALUES (?, ?, ?, ?)').bind(id, match[1], name, now).run();
        return json({ channel: { id, roomId: match[1], name, createdAt: now } }, 201);
      }
    }
    if ((match = path.match(/^\/api\/academy\/channels\/([a-zA-Z0-9_-]{1,100})\/messages$/))) {
      await channelAccess(db, match[1], account.accountId);
      if (request.method === 'GET') {
        const before = url.searchParams.get('before');
        let rows;
        if (before) {
          const cursor = await db.prepare('SELECT created_at, id FROM academy_messages WHERE channel_id = ? AND id = ?').bind(match[1], identifier(before)).first<Row>();
          if (!cursor) missing();
          rows = await db.prepare('SELECT m.id, m.author_id, m.body, m.created_at, a.display_name AS author_name FROM academy_messages m INNER JOIN wizard_accounts a ON a.id = m.author_id WHERE m.channel_id = ? AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?)) ORDER BY m.created_at DESC, m.id DESC LIMIT 101').bind(match[1], cursor.created_at, cursor.created_at, cursor.id).all<Row>();
        } else rows = await db.prepare('SELECT m.id, m.author_id, m.body, m.created_at, a.display_name AS author_name FROM academy_messages m INNER JOIN wizard_accounts a ON a.id = m.author_id WHERE m.channel_id = ? ORDER BY m.created_at DESC, m.id DESC LIMIT 101').bind(match[1]).all<Row>();
        const hasMore = rows.results.length > 100;
        const messages = rows.results.slice(0, 100).reverse().map(row => ({ id: row.id, authorId: row.author_id, authorName: row.author_name, body: row.body, createdAt: row.created_at }));
        return json({ messages, hasMore });
      }
      if (request.method === 'POST') {
        const data = await input(request);
        const body = text(data.body, 'Správa', 4000);
        const id = uid();
        const now = new Date().toISOString();
        await db.prepare('INSERT INTO academy_messages (id, channel_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, match[1], account.accountId, body, now).run();
        return json({ message: { id, authorId: account.accountId, authorName: account.name, body, createdAt: now } }, 201);
      }
    }
    return json({ error: { code: 'not_found', message: 'Táto cesta sa nenašla.' } }, 404);
  } catch (error) {
    if (error instanceof ApiError) return json({ error: { code: error.code, message: error.message } }, error.status);
    console.error('Academy request failed', error instanceof Error ? error.name : 'unknown');
    return json({ error: { code: 'academy_unavailable', message: 'Akadémia teraz neodpovedá. Skús to o chvíľu.' } }, 500);
  }
}
