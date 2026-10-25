import { randomUUID } from "node:crypto";
import { ApiError, guardWrite, json, readJson, requireAccount, verifyCsrf } from "./auth";
import type { AccountSession, AuthEnv } from "./auth";

const BASE = "/api/social";
const DAY_MS = 86_400_000;
const FRIEND_LIMIT = 500;
const MAIL_LIMIT = 500;
const MAIL_DAILY_LIMIT = 30;
interface ProfileRow { visible: number; bio: string; revision: number; updated_at: number }
interface FriendshipRow { id: string; requester_id: string; recipient_id: string; status: "pending" | "accepted"; requested_at: number; accepted_at: number | null; account_id: string; display_name: string; bio: string }
interface MailRow { id: string; sender_id: string; sender_name: string; recipient_id: string; recipient_name: string; subject: string; text: string; created_at: number; read_at: number | null }
const FRIEND_COLUMNS = "f.id,f.requester_id,f.recipient_id,f.status,f.requested_at,f.accepted_at,a.id AS account_id,a.display_name,CASE WHEN p.visible=1 THEN p.bio ELSE '' END AS bio";
const FRIEND_JOIN = " FROM social_friendships f JOIN wizard_accounts a ON a.id=CASE WHEN f.requester_id=? THEN f.recipient_id ELSE f.requester_id END LEFT JOIN social_profiles p ON p.account_id=a.id WHERE (f.requester_id=? OR f.recipient_id=?)";
const MAIL_COLUMNS = "m.id,m.sender_id,s.display_name AS sender_name,m.recipient_id,r.display_name AS recipient_name,m.subject,m.text,m.created_at,m.read_at";
const MAIL_JOIN = " FROM social_mail m JOIN wizard_accounts s ON s.id=m.sender_id JOIN wizard_accounts r ON r.id=m.recipient_id";

function invalid(message: string): ApiError { return new ApiError(422, "invalid_social_data", message); }
function textValue(value: unknown, max: number, label: string, singleLine = false): string {
  if (typeof value !== "string" || value.length > max || (singleLine ? /[\u0000-\u001f\u007f]/ : /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/).test(value)) throw invalid(label + " môže obsahovať najviac " + max + " znakov.");
  return value;
}
function accountId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) throw invalid("Vyber platného čarodeja.");
  return value;
}
function listLimit(params: URLSearchParams): number {
  const value = params.get("limit");
  if (value === null) return 50;
  if (!/^[1-9]\d?$/.test(value) || Number(value) > 50) throw new ApiError(400, "invalid_limit", "Vyber počet od 1 do 50.");
  return Number(value);
}
function mailOffset(params: URLSearchParams): number {
  const value = params.get("offset");
  if (value === null) return 0;
  if (!/^(?:0|[1-9]\d{0,2})$/.test(value) || Number(value) > MAIL_LIMIT) throw new ApiError(400, "invalid_offset", "Vyber platnú stranu pošty.");
  return Number(value);
}
function pair(left: string, right: string): [string, string] { return left < right ? [left, right] : [right, left]; }
function profileData(session: AccountSession, row: ProfileRow | null) {
  return { accountId: session.accountId, displayName: session.name, visible: row?.visible === 1, bio: row?.bio || "", revision: row?.revision || 0, updatedAt: row?.updated_at ?? null };
}
function friendshipData(row: FriendshipRow) {
  return { id: row.id, accountId: row.account_id, displayName: row.display_name, bio: row.bio, status: row.status, requestedAt: row.requested_at, acceptedAt: row.accepted_at };
}
function mailData(row: MailRow) {
  return { id: row.id, senderId: row.sender_id, senderName: row.sender_name, recipientId: row.recipient_id, recipientName: row.recipient_name, subject: row.subject, text: row.text, createdAt: row.created_at, readAt: row.read_at };
}
function profileConflict(): ApiError { return new ApiError(409, "social_profile_conflict", "Profil sa medzitým zmenil. Načítaj ho znova a zopakuj úpravu."); }
function friendshipNotFound(): ApiError { return new ApiError(404, "friendship_not_found", "Táto žiadosť alebo priateľstvo sa nenašlo."); }
function mailNotFound(): ApiError { return new ApiError(404, "mail_not_found", "Táto správa sa nenašla."); }

async function ownedFriendship(env: AuthEnv, session: AccountSession, id: string): Promise<FriendshipRow | null> {
  return env.DB.prepare("SELECT " + FRIEND_COLUMNS + FRIEND_JOIN + " AND f.id=?")
    .bind(session.accountId, session.accountId, session.accountId, id).first<FriendshipRow>();
}
async function existingFriendship(env: AuthEnv, session: AccountSession, target: string): Promise<FriendshipRow | null> {
  const [low, high] = pair(session.accountId, target);
  return env.DB.prepare("SELECT " + FRIEND_COLUMNS + FRIEND_JOIN + " AND f.pair_low=? AND f.pair_high=?")
    .bind(session.accountId, session.accountId, session.accountId, low, high).first<FriendshipRow>();
}
async function ownedMail(env: AuthEnv, session: AccountSession, id: string, recipientOnly = false): Promise<MailRow> {
  const row = await env.DB.prepare("SELECT " + MAIL_COLUMNS + MAIL_JOIN + " WHERE m.id=? AND " + (recipientOnly ? "m.recipient_id=?" : "(m.sender_id=? OR m.recipient_id=?)"))
    .bind(id, session.accountId, ...(recipientOnly ? [] : [session.accountId])).first<MailRow>();
  if (!row) throw mailNotFound();
  return row;
}
async function visibleTarget(env: AuthEnv, target: string): Promise<boolean> {
  return !!await env.DB.prepare("SELECT p.account_id FROM social_profiles p JOIN wizard_accounts a ON a.id=p.account_id WHERE p.account_id=? AND p.visible=1").bind(target).first();
}

async function profileRoute(request: Request, env: AuthEnv, session: AccountSession): Promise<Response | null> {
  if (request.method === "GET") {
    const row = await env.DB.prepare("SELECT visible,bio,revision,updated_at FROM social_profiles WHERE account_id=?").bind(session.accountId).first<ProfileRow>();
    return json({ profile: profileData(session, row) });
  }
  if (request.method !== "PUT") return null;
  const body = await readJson(request, 4096);
  if (typeof body.visible !== "boolean") throw invalid("Vyber, či bude profil viditeľný v Sieni slávy.");
  const bio = textValue(body.bio === undefined ? "" : body.bio, 160, "Predstavenie").trim();
  const revision = body.expectedRevision === undefined ? 0 : body.expectedRevision;
  if (!Number.isSafeInteger(revision) || (revision as number) < 0 || (revision as number) >= Number.MAX_SAFE_INTEGER) throw new ApiError(422, "invalid_revision", "Chýba platná revízia profilu.");
  const updatedAt = Date.now();
  const result = revision === 0
    ? await env.DB.prepare("INSERT INTO social_profiles(account_id,visible,bio,revision,updated_at) VALUES(?,?,?,1,?) ON CONFLICT(account_id) DO NOTHING").bind(session.accountId, body.visible ? 1 : 0, bio, updatedAt).run()
    : await env.DB.prepare("UPDATE social_profiles SET visible=?,bio=?,revision=revision+1,updated_at=? WHERE account_id=? AND revision=?").bind(body.visible ? 1 : 0, bio, updatedAt, session.accountId, revision).run();
  if (result.meta.changes !== 1) throw profileConflict();
  return json({ profile: profileData(session, { visible: body.visible ? 1 : 0, bio, revision: (revision as number) + 1, updated_at: updatedAt }) });
}

async function hallRoute(request: Request, env: AuthEnv, session: AccountSession): Promise<Response | null> {
  if (request.method !== "GET") return null;
  const params = new URL(request.url).searchParams, limit = listLimit(params);
  let query = textValue(params.get("q") || "", 64, "Hľadanie", true).normalize("NFKC").trim().replace(/ +/g, " ");
  // Use the account-name folding rules and bound instr(), so % and _ stay literal.
  for (let pass = 0; pass < 3; pass++) {
    const folded = Array.from(query, char => char === "\u0131" ? char : char.toUpperCase().toLowerCase()).join("").normalize("NFKC");
    if (folded === query) break;
    query = folded;
  }
  const rows = await env.DB.prepare("SELECT a.id AS accountId,a.display_name AS displayName,p.bio FROM social_profiles p JOIN wizard_accounts a ON a.id=p.account_id WHERE p.visible=1 AND a.id<>? AND instr(a.normalized_name,?)>0 ORDER BY a.normalized_name,a.id LIMIT ?")
    .bind(session.accountId, query, limit + 1).all<{ accountId: string; displayName: string; bio: string }>();
  return json({ wizards: rows.results.slice(0, limit), truncated: rows.results.length > limit });
}

async function friendsRoute(request: Request, env: AuthEnv, session: AccountSession, route: string): Promise<Response | null> {
  if (route === BASE + "/friends" && request.method === "GET") {
    const rows = await env.DB.prepare("SELECT " + FRIEND_COLUMNS + FRIEND_JOIN + " ORDER BY f.requested_at DESC,f.id LIMIT ?")
      .bind(session.accountId, session.accountId, session.accountId, FRIEND_LIMIT).all<FriendshipRow>();
    return json({
      accepted: rows.results.filter(row => row.status === "accepted").map(friendshipData),
      incoming: rows.results.filter(row => row.status === "pending" && row.recipient_id === session.accountId).map(friendshipData),
      outgoing: rows.results.filter(row => row.status === "pending" && row.requester_id === session.accountId).map(friendshipData),
    });
  }
  if (route === BASE + "/friends/request" && request.method === "POST") {
    const body = await readJson(request, 4096), target = accountId(body.accountId);
    if (target === session.accountId) throw invalid("Žiadosť o priateľstvo nemôžeš poslať sebe.");
    const existing = await existingFriendship(env, session, target);
    if (existing) return json({ friendship: friendshipData(existing) });
    if (!await visibleTarget(env, target)) throw new ApiError(404, "wizard_not_found", "Tento čarodej nemá verejný profil.");
    const id = randomUUID(), requestedAt = Date.now(), [low, high] = pair(session.accountId, target);
    const result = await env.DB.prepare("INSERT INTO social_friendships(id,pair_low,pair_high,requester_id,recipient_id,status,requested_at,accepted_at) SELECT ?,?,?,?,?,'pending',?,NULL WHERE EXISTS(SELECT 1 FROM social_profiles WHERE account_id=? AND visible=1) AND (SELECT COUNT(*) FROM social_friendships WHERE requester_id=? OR recipient_id=?)<? AND (SELECT COUNT(*) FROM social_friendships WHERE requester_id=? OR recipient_id=?)<? ON CONFLICT(pair_low,pair_high) DO NOTHING")
      .bind(id, low, high, session.accountId, target, requestedAt, target, session.accountId, session.accountId, FRIEND_LIMIT, target, target, FRIEND_LIMIT).run();
    const current = await existingFriendship(env, session, target);
    if (current) return json({ friendship: friendshipData(current) }, result.meta.changes === 1 ? 201 : 200);
    if (!await visibleTarget(env, target)) throw new ApiError(404, "wizard_not_found", "Tento čarodej nemá verejný profil.");
    throw new ApiError(422, "friends_limit", "Niektorý z účtov už dosiahol limit 500 priateľstiev a žiadostí.");
  }
  const responseMatch = new RegExp("^" + BASE + "/friends/([a-zA-Z0-9_-]{1,80})/respond$").exec(route);
  if (responseMatch && request.method === "POST") {
    const body = await readJson(request, 4096);
    if (typeof body.accept !== "boolean") throw invalid("Vyber prijatie alebo odmietnutie žiadosti.");
    const previous = await ownedFriendship(env, session, responseMatch[1]);
    if (!previous || previous.recipient_id !== session.accountId) throw friendshipNotFound();
    if (previous.status === "accepted") {
      if (body.accept) return json({ friendship: friendshipData(previous) });
      throw new ApiError(409, "friendship_not_pending", "Toto priateľstvo už bolo prijaté. Môžeš ho odstrániť zo zoznamu priateľov.");
    }
    if (!body.accept) {
      const result = await env.DB.prepare("DELETE FROM social_friendships WHERE id=? AND recipient_id=? AND status='pending'").bind(responseMatch[1], session.accountId).run();
      if (result.meta.changes !== 1) throw new ApiError(409, "friendship_changed", "Žiadosť sa medzitým zmenila. Načítaj zoznam znova.");
      return json({ ok: true });
    }
    await env.DB.prepare("UPDATE social_friendships SET status='accepted',accepted_at=? WHERE id=? AND recipient_id=? AND status='pending'").bind(Date.now(), responseMatch[1], session.accountId).run();
    const current = await ownedFriendship(env, session, responseMatch[1]);
    if (!current || current.status !== "accepted") throw new ApiError(409, "friendship_changed", "Žiadosť sa medzitým zmenila. Načítaj zoznam znova.");
    return json({ friendship: friendshipData(current) });
  }
  const deleteMatch = new RegExp("^" + BASE + "/friends/([a-zA-Z0-9_-]{1,80})$").exec(route);
  if (deleteMatch && request.method === "DELETE") {
    await readJson(request, 4096);
    const result = await env.DB.prepare("DELETE FROM social_friendships WHERE id=? AND (requester_id=? OR recipient_id=?)").bind(deleteMatch[1], session.accountId, session.accountId).run();
    if (result.meta.changes !== 1) throw friendshipNotFound();
    return json({ ok: true });
  }
  return null;
}

async function sendMail(request: Request, env: AuthEnv, session: AccountSession): Promise<Response> {
  const body = await readJson(request, 64 * 1024), target = accountId(body.recipientId);
  const subject = textValue(body.subject, 160, "Predmet", true).trim(), text = textValue(body.text, 10_000, "Správa");
  if (!subject || !text.trim()) throw invalid("Napíš predmet aj text správy.");
  if (target === session.accountId) throw invalid("Poštu môžeš poslať priateľovi.");
  const [low, high] = pair(session.accountId, target), id = randomUUID(), createdAt = Date.now(), cutoff = createdAt - DAY_MS;
  // One SQLite statement makes friendship, rolling rate, and both mailbox caps
  // part of the insert, including when two requests race for the last free slot.
  const result = await env.DB.prepare("INSERT INTO social_mail(id,sender_id,recipient_id,subject,text,created_at,read_at) SELECT ?,?,?,?,?,?,NULL WHERE EXISTS(SELECT 1 FROM social_friendships WHERE pair_low=? AND pair_high=? AND status='accepted') AND (SELECT COUNT(*) FROM social_mail WHERE sender_id=? AND created_at>=?)<? AND (SELECT COUNT(*) FROM social_mail WHERE sender_id=? OR recipient_id=?)<? AND (SELECT COUNT(*) FROM social_mail WHERE sender_id=? OR recipient_id=?)<?")
    .bind(id, session.accountId, target, subject, text, createdAt, low, high, session.accountId, cutoff, MAIL_DAILY_LIMIT, session.accountId, session.accountId, MAIL_LIMIT, target, target, MAIL_LIMIT).run();
  if (result.meta.changes !== 1) {
    const friendship = await existingFriendship(env, session, target);
    if (!friendship || friendship.status !== "accepted") throw new ApiError(403, "mail_friends_only", "Poštu si môžu posielať iba prijatí priatelia.");
    const sent = await env.DB.prepare("SELECT COUNT(*) AS n FROM social_mail WHERE sender_id=? AND created_at>=?").bind(session.accountId, cutoff).first<{ n: number }>();
    if ((sent?.n || 0) >= MAIL_DAILY_LIMIT) throw new ApiError(429, "mail_rate_limit", "Za posledných 24 hodín si už poslal 30 správ. Skús to neskôr.");
    throw new ApiError(422, "mail_storage_limit", "Niektorá zo schránok dosiahla limit 500 uložených správ. Žiadna správa sa automaticky neodstránila.");
  }
  return json({ message: mailData(await ownedMail(env, session, id)) }, 201);
}

async function mailRoute(request: Request, env: AuthEnv, session: AccountSession, route: string): Promise<Response | null> {
  if (route === BASE + "/mail") {
    if (request.method === "POST") return sendMail(request, env, session);
    if (request.method === "GET") {
      const params = new URL(request.url).searchParams, limit = listLimit(params), offset = mailOffset(params), box = params.get("box") || "inbox";
      if (box !== "inbox" && box !== "sent") throw new ApiError(400, "invalid_mailbox", "Vyber doručenú alebo odoslanú poštu.");
      const rows = await env.DB.prepare("SELECT " + MAIL_COLUMNS + MAIL_JOIN + " WHERE " + (box === "inbox" ? "m.recipient_id=?" : "m.sender_id=?") + " ORDER BY m.created_at DESC,m.id DESC LIMIT ? OFFSET ?")
        .bind(session.accountId, limit + 1, offset).all<MailRow>();
      const truncated = rows.results.length > limit;
      return json({ messages: rows.results.slice(0, limit).map(mailData), truncated, nextOffset: truncated ? offset + limit : null });
    }
  }
  const readMatch = new RegExp("^" + BASE + "/mail/([a-zA-Z0-9_-]{1,80})/read$").exec(route);
  if (readMatch && request.method === "POST") {
    await readJson(request, 4096);
    await ownedMail(env, session, readMatch[1], true);
    await env.DB.prepare("UPDATE social_mail SET read_at=COALESCE(read_at,?) WHERE id=? AND recipient_id=?").bind(Date.now(), readMatch[1], session.accountId).run();
    return json({ message: mailData(await ownedMail(env, session, readMatch[1], true)) });
  }
  const detailMatch = new RegExp("^" + BASE + "/mail/([a-zA-Z0-9_-]{1,80})$").exec(route);
  if (detailMatch && request.method === "GET") return json({ message: mailData(await ownedMail(env, session, detailMatch[1])) });
  return null;
}

export async function handleSocial(request: Request, env: AuthEnv): Promise<Response | null> {
  const route = new URL(request.url).pathname;
  if (route !== BASE && !route.startsWith(BASE + "/")) return null;
  try {
    const session = await requireAccount(request, env);
    if (["POST", "PUT", "DELETE", "PATCH"].includes(request.method)) { guardWrite(request); verifyCsrf(request, session); }
    let response: Response | null = null;
    if (route === BASE + "/profile") response = await profileRoute(request, env, session);
    else if (route === BASE + "/hall") response = await hallRoute(request, env, session);
    else response = await friendsRoute(request, env, session, route) || await mailRoute(request, env, session, route);
    if (response) return response;
    throw new ApiError(405, "method_not_allowed", "Táto operácia nie je podporovaná.");
  } catch (error) {
    const api = error instanceof ApiError ? error : new ApiError(503, "social_unavailable", "Sieň slávy, priatelia alebo pošta teraz nie sú dostupné. Skús to znova.");
    return json({ error: { code: api.code, message: api.message } }, api.status);
  }
}
