import { randomUUID } from "node:crypto";
import { ApiError, guardWrite, json, readJson, requireAccount, verifyCsrf } from "./auth";
import type { AccountSession, AuthEnv } from "./auth";

const BASE = "/api/calendar/events";
const DAY_MS = 24 * 60 * 60 * 1000;
interface EventRow { id: string; title: string; description: string; date: string; time: string; color: string; completed: number; revision: number; updated_at: number }
const COLUMNS = "id,title,description,date,time,color,completed,revision,updated_at";

function eventData(row: EventRow) {
  return { id: row.id, title: row.title, description: row.description, date: row.date, time: row.time, color: row.color, completed: row.completed === 1, revision: row.revision, updatedAt: row.updated_at };
}
function eventError(message: string): ApiError { return new ApiError(422, "invalid_event", message); }
function dateValue(value: unknown): { text: string; utc: number } | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const utc = Date.UTC(year, month - 1, day), normalized = new Date(utc);
  if (normalized.getUTCFullYear() !== year || normalized.getUTCMonth() !== month - 1 || normalized.getUTCDate() !== day) return null;
  return { text: value, utc };
}
function stringValue(value: unknown, max: number, label: string, required = false): string {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw eventError(label + " môže obsahovať najviac " + max + " znakov.");
  const clean = required ? value.trim() : value;
  if (required && !clean) throw eventError("Zadaj názov udalosti.");
  return clean;
}
function fields(body: Record<string, unknown>) {
  const title = stringValue(body.title, 160, "Názov", true);
  const description = stringValue(body.description === undefined ? "" : body.description, 4000, "Popis");
  const date = dateValue(body.date);
  if (!date) throw eventError("Vyber platný dátum od roku 1900 do roku 2200.");
  const time = body.time === undefined ? "" : body.time;
  if (typeof time !== "string" || (time !== "" && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))) throw eventError("Čas musí mať tvar HH:MM, napríklad 08:30.");
  const color = body.color === undefined ? "#d9ae54" : body.color;
  if (typeof color !== "string" || !/^#[a-fA-F0-9]{6}$/.test(color)) throw eventError("Farba musí mať tvar #RRGGBB.");
  const completed = body.completed === undefined ? false : body.completed;
  if (typeof completed !== "boolean") throw eventError("Splnenie udalosti musí byť áno alebo nie.");
  return { title, description, date: date.text, time, color, completed };
}
function revisionValue(body: Record<string, unknown>): number {
  const revision = body.expectedRevision;
  if (!Number.isSafeInteger(revision) || (revision as number) < 1 || (revision as number) >= Number.MAX_SAFE_INTEGER) throw new ApiError(422, "invalid_revision", "Chýba platná revízia udalosti.");
  return revision as number;
}
async function ownedEvent(env: AuthEnv, session: AccountSession, id: string): Promise<EventRow> {
  const row = await env.DB.prepare("SELECT " + COLUMNS + " FROM calendar_events WHERE id=? AND account_id=?").bind(id, session.accountId).first<EventRow>();
  if (!row) throw new ApiError(404, "event_not_found", "Táto udalosť sa nenašla.");
  return row;
}
function conflict(): ApiError { return new ApiError(409, "calendar_conflict", "Udalosť sa medzitým zmenila. Načítaj kalendár znova a zopakuj úpravu."); }

interface DayRow { date: string; type: string; revision: number; updated_at: number }
const DAY_TYPES = ["", "work8", "work12", "school", "free"];
function range(request: Request) {
  const params = new URL(request.url).searchParams;
  const from = dateValue(params.get("from")), to = dateValue(params.get("to"));
  if (!from || !to || to.utc < from.utc || (to.utc - from.utc) / DAY_MS >= 370) throw new ApiError(400, "invalid_range", "Vyber rozsah s najviac 370 dňami.");
  return { from: from.text, to: to.text };
}
function dayData(row: DayRow) { return { date: row.date, type: row.type, revision: row.revision, updatedAt: row.updated_at }; }
async function dayRoutes(request: Request, env: AuthEnv, session: AccountSession): Promise<Response | null> {
  const route = new URL(request.url).pathname;
  if (route === "/api/calendar/days" && request.method === "GET") {
    const dates = range(request);
    const rows = await env.DB.prepare("SELECT date,type,revision,updated_at FROM calendar_days WHERE account_id=? AND date>=? AND date<=? ORDER BY date").bind(session.accountId, dates.from, dates.to).all<DayRow>();
    return json({ days: rows.results.map(dayData) });
  }
  if (route === "/api/calendar/backup" && request.method === "GET") {
    const rows = await env.DB.prepare("SELECT date,type FROM calendar_days WHERE account_id=? AND type<>'' ORDER BY date").bind(session.accountId).all<{ date: string; type: string }>();
    return json({ version: 2, days: Object.fromEntries(rows.results.map(row => [row.date, row.type])) });
  }
  const match = /^\/api\/calendar\/days\/(\d{4}-\d{2}-\d{2})$/.exec(route);
  if (match && request.method === "PUT") {
    if (!dateValue(match[1])) throw eventError("Neplatný dátum.");
    const body = await readJson(request, 4096), revision = body.expectedRevision;
    if (typeof body.type !== "string" || !DAY_TYPES.includes(body.type)) throw eventError("Vyber platný typ dňa.");
    if (!Number.isSafeInteger(revision) || (revision as number) < 0 || (revision as number) >= Number.MAX_SAFE_INTEGER) throw eventError("Chýba platná revízia dňa.");
    const now = Date.now();
    const result = revision === 0
      ? await env.DB.prepare("INSERT INTO calendar_days(account_id,date,type,revision,updated_at) VALUES(?,?,?,1,?) ON CONFLICT(account_id,date) DO NOTHING").bind(session.accountId, match[1], body.type, now).run()
      : await env.DB.prepare("UPDATE calendar_days SET type=?,revision=revision+1,updated_at=? WHERE account_id=? AND date=? AND revision=?").bind(body.type, now, session.accountId, match[1], revision).run();
    if (result.meta.changes !== 1) throw conflict();
    return json({ day: { date: match[1], type: body.type, revision: (revision as number) + 1, updatedAt: now } });
  }
  if (route === "/api/calendar/import" && request.method === "POST") {
    const body = await readJson(request, 2 * 1024 * 1024);
    if (![1, 2].includes(body.version as number) || !body.days || typeof body.days !== "object" || Array.isArray(body.days)) throw eventError("Vyber platnú zálohu pôvodného kalendára.");
    const entries = Object.entries(body.days);
    if (entries.length > 50000) throw eventError("Záloha má príliš veľa dní.");
    for (const [date, type] of entries) if (!dateValue(date) || typeof type !== "string" || !DAY_TYPES.slice(1).includes(type)) throw eventError("Záloha obsahuje neplatný deň alebo typ.");
    let imported = 0; const now = Date.now();
    for (let start = 0; start < entries.length; start += 100) {
      const batch = entries.slice(start, start + 100).map(([date, type]) => env.DB.prepare("INSERT INTO calendar_days(account_id,date,type,revision,updated_at) VALUES(?,?,?,1,?) ON CONFLICT(account_id,date) DO NOTHING").bind(session.accountId, date, type, now));
      const results = await env.DB.batch(batch);
      imported += results.reduce((sum, result) => sum + Number(result.meta.changes), 0);
    }
    return json({ imported, skipped: entries.length - imported });
  }
  return null;
}

async function list(request: Request, env: AuthEnv, session: AccountSession): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const from = dateValue(params.get("from")), to = dateValue(params.get("to"));
  if (!from || !to || to.utc < from.utc || (to.utc - from.utc) / DAY_MS >= 370) throw new ApiError(400, "invalid_range", "Vyber platný rozsah od–do s najviac 370 dňami.");
  const result = await env.DB.prepare("SELECT " + COLUMNS + " FROM calendar_events WHERE account_id=? AND date>=? AND date<=? ORDER BY date,time,id")
    .bind(session.accountId, from.text, to.text).all<EventRow>();
  return json({ events: result.results.map(eventData) });
}
async function create(request: Request, env: AuthEnv, session: AccountSession): Promise<Response> {
  const body = await readJson(request, 32 * 1024), data = fields(body);
  const id = randomUUID(), updatedAt = Date.now();
  await env.DB.prepare("INSERT INTO calendar_events(id,account_id,title,description,date,time,color,completed,revision,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?)")
    .bind(id, session.accountId, data.title, data.description, data.date, data.time, data.color, data.completed ? 1 : 0, updatedAt).run();
  return json({ event: { id, ...data, revision: 1, updatedAt } }, 201);
}
async function update(request: Request, env: AuthEnv, session: AccountSession, id: string): Promise<Response> {
  const body = await readJson(request, 32 * 1024), revision = revisionValue(body);
  const previous = await ownedEvent(env, session, id);
  if (previous.revision !== revision) throw conflict();
  const data = fields(body), updatedAt = Date.now();
  const result = await env.DB.prepare("UPDATE calendar_events SET title=?,description=?,date=?,time=?,color=?,completed=?,revision=revision+1,updated_at=? WHERE id=? AND account_id=? AND revision=?")
    .bind(data.title, data.description, data.date, data.time, data.color, data.completed ? 1 : 0, updatedAt, id, session.accountId, revision).run();
  if (result.meta.changes !== 1) throw conflict();
  return json({ event: { id, ...data, revision: revision + 1, updatedAt } });
}
async function remove(request: Request, env: AuthEnv, session: AccountSession, id: string): Promise<Response> {
  const body = await readJson(request, 4096), revision = revisionValue(body);
  const previous = await ownedEvent(env, session, id);
  if (previous.revision !== revision) throw conflict();
  const result = await env.DB.prepare("DELETE FROM calendar_events WHERE id=? AND account_id=? AND revision=?").bind(id, session.accountId, revision).run();
  if (result.meta.changes !== 1) throw conflict();
  return json({ ok: true });
}

export async function handleCalendar(request: Request, env: AuthEnv): Promise<Response | null> {
  const route = new URL(request.url).pathname;
  if (!route.startsWith("/api/calendar/")) return null;
  try {
    const session = await requireAccount(request, env);
    if (["POST", "PUT", "DELETE", "PATCH"].includes(request.method)) { guardWrite(request); verifyCsrf(request, session); }
    const days = await dayRoutes(request, env, session); if (days) return days;
    if (route === BASE && request.method === "GET") return await list(request, env, session);
    if (route === BASE && request.method === "POST") return await create(request, env, session);
    const match = new RegExp("^" + BASE + "/([a-zA-Z0-9_-]{1,80})$").exec(route);
    if (match) {
      if (request.method === "GET") return json({ event: eventData(await ownedEvent(env, session, match[1])) });
      if (request.method === "PUT") return await update(request, env, session, match[1]);
      if (request.method === "DELETE") return await remove(request, env, session, match[1]);
    }
    throw new ApiError(405, "method_not_allowed", "Táto operácia nie je podporovaná.");
  } catch (error) {
    const api = error instanceof ApiError ? error : new ApiError(503, "calendar_unavailable", "Kalendár sa momentálne nedá načítať alebo uložiť. Skús to znova.");
    return json({ error: { code: api.code, message: api.message } }, api.status);
  }
}
