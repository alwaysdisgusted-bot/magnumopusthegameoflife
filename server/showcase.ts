import { ApiError, guardWrite, json, readJson, requireAccount, verifyCsrf } from "./auth";
import type { AccountSession, AuthEnv } from "./auth";
import { QUOTE_IDS } from "./quotes";

const SHOWCASE = "/api/social/showcase";
const WIZARDS = "/api/social/wizards/";
const PAGE_SIZE = 20;
interface ShowcaseRow { quote_ids: string; revision: number; updated_at: number }
interface PublicProfile { account_id: string; display_name: string; visible: number | null; bio: string | null }
interface PublicNote { id: string; title: string; text: string; updated_at: number; featured: number }
const PUBLIC_NOTE_COLUMNS = "n.id,n.title,n.text,n.updated_at,n.featured";
const PUBLIC_NOTE_GATE = "n.account_id=? AND n.visibility='public' AND (?=n.account_id OR EXISTS(SELECT 1 FROM social_profiles p WHERE p.account_id=n.account_id AND p.visible=1))";
const FILTERED_QUOTES = "(SELECT json_group_array(value) FROM json_each(s.quote_ids) WHERE EXISTS(SELECT 1 FROM saved_quotes q WHERE q.account_id=s.account_id AND q.quote_id=value)) AS quote_ids";

function parseQuoteIds(value: string): string[] {
  const ids: unknown = JSON.parse(value);
  return Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => typeof id === "string" && QUOTE_IDS.has(id)))].slice(0, 6) : [];
}
function showcaseData(row: ShowcaseRow | null) {
  return { quoteIds: row ? parseQuoteIds(row.quote_ids) : [], revision: row?.revision ?? 0, updatedAt: row?.updated_at ?? null };
}
function noteData(row: PublicNote) { return { id: row.id, title: row.title, text: row.text, updatedAt: row.updated_at, featured: row.featured === 1 }; }
function notFound(): ApiError { return new ApiError(404, "wizard_not_found", "Tento profil alebo verejná poznámka sa nenašli."); }
function conflict(): ApiError { return new ApiError(409, "showcase_conflict", "Vystavené citáty sa medzitým zmenili. Načítaj ich znova a zopakuj úpravu."); }
function offsetValue(params: URLSearchParams): number {
  const value = params.get("offset");
  if (value === null) return 0;
  if (!/^(?:0|[1-9]\d{0,3})$/.test(value) || Number(value) > 1000) throw new ApiError(400, "invalid_offset", "Vyber platnú stranu poznámok.");
  return Number(value);
}

async function ownShowcase(request: Request, env: AuthEnv, session: AccountSession): Promise<Response | null> {
  if (request.method === "GET") {
    const row = await env.DB.prepare("SELECT " + FILTERED_QUOTES + ",s.revision,s.updated_at FROM profile_showcases s WHERE s.account_id=?").bind(session.accountId).first<ShowcaseRow>();
    return json({ showcase: showcaseData(row) });
  }
  if (request.method !== "PUT") return null;
  const body = await readJson(request, 4096), ids = body.quoteIds, revision = body.expectedRevision;
  if (!Array.isArray(ids) || ids.length > 6 || ids.some(id => typeof id !== "string" || !QUOTE_IDS.has(id)) || new Set(ids).size !== ids.length) throw new ApiError(422, "invalid_showcase_quotes", "Vyber najviac 6 rôznych citátov z uloženej zbierky.");
  if (!Number.isSafeInteger(revision) || (revision as number) < 0 || (revision as number) >= Number.MAX_SAFE_INTEGER) throw new ApiError(422, "invalid_revision", "Chýba platná revízia vystavených citátov.");
  const quoteIds = ids as string[], encoded = JSON.stringify(quoteIds), updatedAt = Date.now();
  // Saved membership and revision are part of the same SQLite write. A concurrent
  // removal can never be overwritten by a stale editor's selection.
  const membership = "(SELECT COUNT(*) FROM json_each(?) j WHERE EXISTS(SELECT 1 FROM saved_quotes q WHERE q.account_id=? AND q.quote_id=j.value))=?";
  const result = revision === 0
    ? await env.DB.prepare("INSERT INTO profile_showcases(account_id,quote_ids,revision,updated_at) SELECT ?,?,1,? WHERE " + membership + " ON CONFLICT(account_id) DO NOTHING").bind(session.accountId, encoded, updatedAt, encoded, session.accountId, quoteIds.length).run()
    : await env.DB.prepare("UPDATE profile_showcases SET quote_ids=?,revision=revision+1,updated_at=? WHERE account_id=? AND revision=? AND " + membership).bind(encoded, updatedAt, session.accountId, revision, encoded, session.accountId, quoteIds.length).run();
  if (result.meta.changes !== 1) {
    const current = await env.DB.prepare("SELECT revision FROM profile_showcases WHERE account_id=?").bind(session.accountId).first<{ revision: number }>();
    if ((current?.revision ?? 0) !== revision) throw conflict();
    throw new ApiError(422, "showcase_quote_not_saved", "Najprv si vybrané citáty ulož do svojej zbierky.");
  }
  return json({ showcase: { quoteIds, revision: (revision as number) + 1, updatedAt } });
}

async function publicWizard(request: Request, env: AuthEnv, session: AccountSession, target: string, noteId?: string): Promise<Response> {
  const offset = offsetValue(new URL(request.url).searchParams);
  // Only another authenticated wizard with an opted-in profile is discoverable.
  // The owner can preview exactly the same public projection before opting in.
  const profile = await env.DB.prepare("SELECT a.id AS account_id,a.display_name,p.visible,p.bio FROM wizard_accounts a LEFT JOIN social_profiles p ON p.account_id=a.id WHERE a.id=? AND (a.id=? OR p.visible=1)").bind(target, session.accountId).first<PublicProfile>();
  if (!profile) throw notFound();
  if (noteId) {
    const note = await env.DB.prepare("SELECT " + PUBLIC_NOTE_COLUMNS + " FROM calendar_notes n WHERE " + PUBLIC_NOTE_GATE + " AND n.id=?").bind(target, session.accountId, noteId).first<PublicNote>();
    if (!note) throw notFound();
    return json({ note: noteData(note) });
  }
  const selected = await env.DB.prepare("SELECT " + FILTERED_QUOTES + ",s.revision,s.updated_at FROM profile_showcases s WHERE s.account_id=? AND (s.account_id=? OR EXISTS(SELECT 1 FROM social_profiles p WHERE p.account_id=s.account_id AND p.visible=1))").bind(target, session.accountId).first<ShowcaseRow>();
  const featured = await env.DB.prepare("SELECT " + PUBLIC_NOTE_COLUMNS + " FROM calendar_notes n WHERE " + PUBLIC_NOTE_GATE + " AND n.featured=1 ORDER BY n.updated_at DESC,n.id LIMIT 6").bind(target, session.accountId).all<PublicNote>();
  const notes = await env.DB.prepare("SELECT " + PUBLIC_NOTE_COLUMNS + " FROM calendar_notes n WHERE " + PUBLIC_NOTE_GATE + " ORDER BY n.featured DESC,n.updated_at DESC,n.id LIMIT ? OFFSET ?").bind(target, session.accountId, PAGE_SIZE + 1, offset).all<PublicNote>();
  return json({
    profile: { accountId: profile.account_id, displayName: profile.display_name, bio: profile.bio ?? "", visible: profile.visible === 1 },
    quoteIds: selected ? parseQuoteIds(selected.quote_ids) : [],
    featuredNotes: featured.results.map(noteData),
    notes: notes.results.slice(0, PAGE_SIZE).map(row => ({ id: row.id, title: row.title, excerpt: row.text.replace(/\s+/g, " ").trim().slice(0, 240), updatedAt: row.updated_at, featured: row.featured === 1 })),
    nextOffset: notes.results.length > PAGE_SIZE && offset + PAGE_SIZE <= 1000 ? offset + PAGE_SIZE : null,
  });
}

export async function handleShowcase(request: Request, env: AuthEnv): Promise<Response | null> {
  const route = new URL(request.url).pathname;
  if (route !== SHOWCASE && !route.startsWith(WIZARDS)) return null;
  try {
    const session = await requireAccount(request, env);
    if (["POST", "PUT", "DELETE", "PATCH"].includes(request.method)) { guardWrite(request); verifyCsrf(request, session); }
    if (route === SHOWCASE) {
      const response = await ownShowcase(request, env, session);
      if (response) return response;
    } else {
      const match = /^\/api\/social\/wizards\/([a-zA-Z0-9_-]{1,80})(?:\/notes\/([a-zA-Z0-9_-]{1,80}))?$/.exec(route);
      if (!match) throw notFound();
      if (request.method === "GET") return await publicWizard(request, env, session, match[1], match[2]);
    }
    throw new ApiError(405, "method_not_allowed", "Táto operácia nie je podporovaná.");
  } catch (error) {
    const api = error instanceof ApiError ? error : new ApiError(503, "showcase_unavailable", "Profil a vystavené poznámky či citáty teraz nie sú dostupné. Skús to znova.");
    return json({ error: { code: api.code, message: api.message } }, api.status);
  }
}
