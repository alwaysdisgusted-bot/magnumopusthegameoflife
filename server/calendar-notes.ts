import { randomUUID } from "node:crypto";
import { ApiError, guardWrite, json, readJson, requireAccount, verifyCsrf } from "./auth";
import type { AccountSession, AuthEnv } from "./auth";

const NOTES = "/api/calendar/notes";
const BIRTHDAYS = "/api/calendar/birthdays";
const DAY_MS = 86_400_000;
const NOTE_LIMIT = 1000;
const BIRTHDAY_LIMIT = 500;
const VIEWS = new Set(["village", "library", "gym", "meditation", "gallery", "farm", "shop", "challenges", "bank", "calendar", "profile", "settings", "academy", "workspace", "quotes", "desk", "study", "notes", "hall", "mail"]);
const NOTE_COLUMNS = "id,date,title,text,pins,visibility,featured,revision,updated_at";
const BIRTHDAY_COLUMNS = "id,name,month,day,year,revision,updated_at";
interface NoteRow { id: string; date: string; title: string; text: string; pins: string; visibility: "private" | "public"; featured: number; revision: number; updated_at: number }
interface BirthdayRow { id: string; name: string; month: number; day: number; year: number | null; revision: number; updated_at: number }

function invalid(message: string): ApiError { return new ApiError(422, "invalid_calendar_note", message); }
function textValue(value: unknown, max: number, label: string): string {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw invalid(label + " môže obsahovať najviac " + max + " znakov.");
  return value;
}
function dateValue(value: unknown): { text: string; utc: number } | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const utc = Date.UTC(year, month - 1, day), actual = new Date(utc);
  return actual.getUTCFullYear() === year && actual.getUTCMonth() === month - 1 && actual.getUTCDate() === day ? { text: value, utc } : null;
}
function noteFields(body: Record<string, unknown>, previous?: NoteRow) {
  const date = dateValue(body.date);
  if (!date) throw invalid("Vyber platný dátum od roku 1900 do roku 2100.");
  const title = textValue(body.title === undefined ? "" : body.title, 160, "Názov").trim();
  const text = textValue(body.text === undefined ? "" : body.text, 20_000, "Poznámka");
  if (!title && !text.trim()) throw invalid("Napíš názov alebo text poznámky.");
  const pins = body.pins === undefined ? [] : body.pins;
  if (!Array.isArray(pins) || pins.length > VIEWS.size || pins.some(pin => typeof pin !== "string" || !VIEWS.has(pin)) || new Set(pins).size !== pins.length) throw invalid("Vyber platné sekcie na pripnutie poznámky.");
  const visibility = body.visibility === undefined ? previous?.visibility ?? "private" : body.visibility;
  const selectedFeatured = body.featured === undefined ? previous?.featured === 1 : body.featured;
  if (visibility !== "private" && visibility !== "public") throw invalid("Vyber súkromnú alebo verejnú poznámku.");
  if (typeof selectedFeatured !== "boolean") throw invalid("Vyber, či má byť poznámka vystavená na profile.");
  return { date: date.text, title, text, pins: pins as string[], visibility, featured: visibility === "public" && selectedFeatured };
}
function birthdayFields(body: Record<string, unknown>) {
  const name = textValue(body.name, 160, "Meno").trim();
  if (!name) throw invalid("Zadaj meno oslávenca.");
  const { month, day } = body;
  const year = body.year === undefined ? null : body.year;
  if (!Number.isInteger(month) || !Number.isInteger(day) || (month as number) < 1 || (month as number) > 12 || (day as number) < 1 || (day as number) > 31) throw invalid("Vyber platný deň a mesiac narodenín.");
  if (year !== null && (!Number.isInteger(year) || (year as number) < 1900 || (year as number) > 2100)) throw invalid("Rok narodenia môže byť prázdny alebo od 1900 do 2100.");
  const actual = new Date(Date.UTC(year === null ? 2000 : year as number, (month as number) - 1, day as number));
  if (actual.getUTCMonth() !== (month as number) - 1 || actual.getUTCDate() !== day) throw invalid("Tento deň v zadanom mesiaci a roku neexistuje.");
  return { name, month: month as number, day: day as number, year: year as number | null };
}
function revisionValue(body: Record<string, unknown>): number {
  if (!Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 1 || (body.expectedRevision as number) >= Number.MAX_SAFE_INTEGER) throw new ApiError(422, "invalid_revision", "Chýba platná revízia záznamu.");
  return body.expectedRevision as number;
}
function noteData(row: NoteRow) { return { id: row.id, date: row.date, title: row.title, text: row.text, pins: JSON.parse(row.pins) as string[], visibility: row.visibility, featured: row.featured === 1, revision: row.revision, updatedAt: row.updated_at }; }
function birthdayData(row: BirthdayRow) { return { id: row.id, name: row.name, month: row.month, day: row.day, year: row.year, revision: row.revision, updatedAt: row.updated_at }; }
function conflict(): ApiError { return new ApiError(409, "calendar_notes_conflict", "Záznam sa medzitým zmenil. Načítaj ho znova a zopakuj úpravu."); }
function featuredLimit(): ApiError { return new ApiError(422, "featured_notes_limit", "Na profile môžeš vystaviť najviac 6 verejných poznámok."); }
async function ownedNote(env: AuthEnv, session: AccountSession, id: string): Promise<NoteRow> {
  const row = await env.DB.prepare("SELECT " + NOTE_COLUMNS + " FROM calendar_notes WHERE id=? AND account_id=?").bind(id, session.accountId).first<NoteRow>();
  if (!row) throw new ApiError(404, "note_not_found", "Táto poznámka sa nenašla.");
  return row;
}
async function ownedBirthday(env: AuthEnv, session: AccountSession, id: string): Promise<BirthdayRow> {
  const row = await env.DB.prepare("SELECT " + BIRTHDAY_COLUMNS + " FROM calendar_birthdays WHERE id=? AND account_id=?").bind(id, session.accountId).first<BirthdayRow>();
  if (!row) throw new ApiError(404, "birthday_not_found", "Tieto narodeniny sa nenašli.");
  return row;
}

async function notesRoute(request: Request, env: AuthEnv, session: AccountSession, route: string): Promise<Response | null> {
  if (route === NOTES && request.method === "GET") {
    const params = new URL(request.url).searchParams;
    let sql = "SELECT " + NOTE_COLUMNS + " FROM calendar_notes WHERE account_id=?", values: string[] = [session.accountId];
    if (params.has("all")) {
      if (params.get("all") !== "1" || params.has("section") || params.has("from") || params.has("to")) throw new ApiError(400, "invalid_range", "Vyber všetky poznámky alebo jeden dátumový rozsah či sekciu.");
      sql += " ORDER BY date DESC,updated_at DESC,id";
    } else if (params.has("section")) {
      const section = params.get("section");
      if (!section || !VIEWS.has(section) || params.has("from") || params.has("to")) throw new ApiError(400, "invalid_section", "Vyber platnú sekciu poznámok.");
      sql += " AND EXISTS(SELECT 1 FROM json_each(calendar_notes.pins) WHERE value=?)";
      values.push(section);
      sql += " ORDER BY date DESC,updated_at DESC,id";
    } else {
      const from = dateValue(params.get("from")), to = dateValue(params.get("to"));
      if (!from || !to || to.utc < from.utc || (to.utc - from.utc) / DAY_MS >= 370) throw new ApiError(400, "invalid_range", "Vyber rozsah s najviac 370 dňami.");
      sql += " AND date>=? AND date<=? ORDER BY date,updated_at DESC,id";
      values.push(from.text, to.text);
    }
    const rows = await env.DB.prepare(sql + " LIMIT " + NOTE_LIMIT).bind(...values).all<NoteRow>();
    return json({ notes: rows.results.map(noteData), truncated: false });
  }
  if (route === NOTES && request.method === "POST") {
    const data = noteFields(await readJson(request, 100 * 1024)), id = randomUUID(), updatedAt = Date.now();
    const result = await env.DB.prepare("INSERT INTO calendar_notes(id,account_id,date,title,text,pins,visibility,featured,revision,updated_at) SELECT ?,?,?,?,?,?,?,?,1,? WHERE (SELECT COUNT(*) FROM calendar_notes WHERE account_id=?)<? AND (?=0 OR (SELECT COUNT(*) FROM calendar_notes WHERE account_id=? AND visibility='public' AND featured=1)<6)")
      .bind(id, session.accountId, data.date, data.title, data.text, JSON.stringify(data.pins), data.visibility, data.featured ? 1 : 0, updatedAt, session.accountId, NOTE_LIMIT, data.featured ? 1 : 0, session.accountId).run();
    if (result.meta.changes !== 1) {
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM calendar_notes WHERE account_id=?").bind(session.accountId).first<{ n: number }>();
      if ((count?.n ?? 0) >= NOTE_LIMIT) throw new ApiError(422, "notes_limit", "Máš už 1000 poznámok. Pred pridaním ďalšej niektorú odstráň.");
      throw featuredLimit();
    }
    return json({ note: { id, ...data, revision: 1, updatedAt } }, 201);
  }
  const match = new RegExp("^" + NOTES + "/([a-zA-Z0-9_-]{1,80})$").exec(route);
  if (!match) return null;
  if (request.method === "GET") return json({ note: noteData(await ownedNote(env, session, match[1])) });
  if (request.method === "PUT" || request.method === "DELETE") {
    const body = await readJson(request, request.method === "DELETE" ? 4096 : 100 * 1024), revision = revisionValue(body);
    const previous = await ownedNote(env, session, match[1]);
    if (previous.revision !== revision) throw conflict();
    if (request.method === "DELETE") {
      const result = await env.DB.prepare("DELETE FROM calendar_notes WHERE id=? AND account_id=? AND revision=?").bind(match[1], session.accountId, revision).run();
      if (result.meta.changes !== 1) throw conflict();
      return json({ ok: true });
    }
    const data = noteFields(body, previous), updatedAt = Date.now();
    const result = await env.DB.prepare("UPDATE calendar_notes SET date=?,title=?,text=?,pins=?,visibility=?,featured=?,revision=revision+1,updated_at=? WHERE id=? AND account_id=? AND revision=? AND (?=0 OR (SELECT COUNT(*) FROM calendar_notes WHERE account_id=? AND visibility='public' AND featured=1 AND id<>?)<6)")
      .bind(data.date, data.title, data.text, JSON.stringify(data.pins), data.visibility, data.featured ? 1 : 0, updatedAt, match[1], session.accountId, revision, data.featured ? 1 : 0, session.accountId, match[1]).run();
    if (result.meta.changes !== 1) {
      if ((await ownedNote(env, session, match[1])).revision !== revision) throw conflict();
      throw featuredLimit();
    }
    return json({ note: { id: match[1], ...data, revision: revision + 1, updatedAt } });
  }
  return null;
}

async function birthdaysRoute(request: Request, env: AuthEnv, session: AccountSession, route: string): Promise<Response | null> {
  if (route === BIRTHDAYS && request.method === "GET") {
    const rows = await env.DB.prepare("SELECT " + BIRTHDAY_COLUMNS + " FROM calendar_birthdays WHERE account_id=? ORDER BY month,day,name,id LIMIT " + BIRTHDAY_LIMIT).bind(session.accountId).all<BirthdayRow>();
    return json({ birthdays: rows.results.map(birthdayData) });
  }
  if (route === BIRTHDAYS && request.method === "POST") {
    const data = birthdayFields(await readJson(request, 4096)), id = randomUUID(), updatedAt = Date.now();
    const result = await env.DB.prepare("INSERT INTO calendar_birthdays(id,account_id,name,month,day,year,revision,updated_at) SELECT ?,?,?,?,?,?,1,? WHERE (SELECT COUNT(*) FROM calendar_birthdays WHERE account_id=?)<?")
      .bind(id, session.accountId, data.name, data.month, data.day, data.year, updatedAt, session.accountId, BIRTHDAY_LIMIT).run();
    if (result.meta.changes !== 1) throw new ApiError(422, "birthdays_limit", "Máš už 500 narodenín. Pred pridaním ďalších niektoré odstráň.");
    return json({ birthday: { id, ...data, revision: 1, updatedAt } }, 201);
  }
  const match = new RegExp("^" + BIRTHDAYS + "/([a-zA-Z0-9_-]{1,80})$").exec(route);
  if (!match) return null;
  if (request.method === "GET") return json({ birthday: birthdayData(await ownedBirthday(env, session, match[1])) });
  if (request.method === "PUT" || request.method === "DELETE") {
    const body = await readJson(request, 4096), revision = revisionValue(body);
    const previous = await ownedBirthday(env, session, match[1]);
    if (previous.revision !== revision) throw conflict();
    if (request.method === "DELETE") {
      const result = await env.DB.prepare("DELETE FROM calendar_birthdays WHERE id=? AND account_id=? AND revision=?").bind(match[1], session.accountId, revision).run();
      if (result.meta.changes !== 1) throw conflict();
      return json({ ok: true });
    }
    const data = birthdayFields(body), updatedAt = Date.now();
    const result = await env.DB.prepare("UPDATE calendar_birthdays SET name=?,month=?,day=?,year=?,revision=revision+1,updated_at=? WHERE id=? AND account_id=? AND revision=?")
      .bind(data.name, data.month, data.day, data.year, updatedAt, match[1], session.accountId, revision).run();
    if (result.meta.changes !== 1) throw conflict();
    return json({ birthday: { id: match[1], ...data, revision: revision + 1, updatedAt } });
  }
  return null;
}

export async function handleCalendarNotes(request: Request, env: AuthEnv): Promise<Response | null> {
  const route = new URL(request.url).pathname;
  if (route !== NOTES && !route.startsWith(NOTES + "/") && route !== BIRTHDAYS && !route.startsWith(BIRTHDAYS + "/")) return null;
  try {
    const session = await requireAccount(request, env);
    if (["POST", "PUT", "DELETE", "PATCH"].includes(request.method)) { guardWrite(request); verifyCsrf(request, session); }
    const response = await notesRoute(request, env, session, route) || await birthdaysRoute(request, env, session, route);
    if (response) return response;
    throw new ApiError(405, "method_not_allowed", "Táto operácia nie je podporovaná.");
  } catch (error) {
    const api = error instanceof ApiError ? error : new ApiError(503, "calendar_notes_unavailable", "Poznámky alebo narodeniny sa teraz nedajú načítať či uložiť. Skús to znova.");
    return json({ error: { code: api.code, message: api.message } }, api.status);
  }
}
