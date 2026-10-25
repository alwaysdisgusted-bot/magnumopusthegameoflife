import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import GameModel from "./game-model.mjs";

export interface AuthEnv { DB: D1Database; BUCKET: R2Bucket; DEV?: boolean | string; MAGNUM_LOCAL_MODE?: string }
export interface AccountSession { accountId: string; ownerId: string; name: string; csrfHash: string; sessionHash: string }
interface SessionRow { account_id: string; owner_id: string; display_name: string; csrf_value: string; token_hash: string }
interface AccountRow { id: string; owner_id: string; display_name: string; password_hash: string }
interface SaveRow { revision: number; object_key: string; updated_at: number }

const MAX_BYTES = 10 * 1024 * 1024;
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const CANONICAL_ORIGIN = "https://magnum-opus-game-of-life.petojasic.chatgpt.site";
const SCRYPT = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const encoder = new TextEncoder();
const LOCAL_OWNER = "magnum-local-personal-v1";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); this.name = "ApiError"; }
}

export function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store, private");
  headers.set("Pragma", "no-cache");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Vary", "Cookie");
  return new Response(JSON.stringify(data), { status, headers });
}

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function equalHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex"), right = Buffer.from(b, "hex");
  return left.length === 32 && right.length === 32 && timingSafeEqual(left, right);
}
export function isPersonalLocal(request: Request, env: AuthEnv): boolean {
  const url = new URL(request.url);
  return env.MAGNUM_LOCAL_MODE === "1" && (env.DEV === true || env.DEV === "true") &&
    url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
}
function guardPersonalContext(request: Request, env: AuthEnv): void {
  if (env.MAGNUM_LOCAL_MODE !== "1") return;
  if (!isPersonalLocal(request, env)) throw new ApiError(403, "local_only", "Táto osobná hra je dostupná iba v tomto počítači.");
  const origin = request.headers.get("Origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("Sec-Fetch-Site") === "cross-site") {
    throw new ApiError(403, "invalid_origin", "Otvoriť môžeš iba túto lokálnu hru.");
  }
}
function owner(request: Request, env: AuthEnv): string {
  guardPersonalContext(request, env);
  if (isPersonalLocal(request, env)) return LOCAL_OWNER;
  const value = request.headers.get("oai-authenticated-user-id");
  if (!value || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) throw new ApiError(401, "site_login_required", "Najprv sa prihlás cez ChatGPT.");
  return value;
}
function bindings(env: AuthEnv): void {
  if (!env.DB || !env.BUCKET) throw new ApiError(503, "storage_unavailable", "Cloudové úložisko momentálne nie je dostupné.");
}

export function guardWrite(request: Request): void {
  const origin = request.headers.get("Origin");
  if (!origin || (origin !== new URL(request.url).origin && origin !== CANONICAL_ORIGIN)) throw new ApiError(403, "invalid_origin", "Požiadavka musí prísť z tejto hry.");
  if (request.headers.get("X-MO-Request") !== "1") throw new ApiError(403, "invalid_request", "Obnov stránku a skús to znova.");
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") || "")) throw new ApiError(415, "json_required", "Požiadavka musí obsahovať JSON.");
}

export function verifyCsrf(request: Request, session: AccountSession): void {
  const token = request.headers.get("X-MO-CSRF") || "";
  if (!/^[a-f0-9]{64}$/.test(token) || !equalHash(hash(token), session.csrfHash)) throw new ApiError(403, "csrf_failed", "Prihlásenie sa zmenilo. Obnov stránku.");
}

export async function readJson(request: Request, maxBytes = MAX_BYTES): Promise<Record<string, unknown>> {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)) throw new ApiError(413, "body_too_large", "Požiadavka je príliš veľká.");
  if (!request.body) throw new ApiError(400, "invalid_json", "Chýba obsah požiadavky.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new ApiError(413, "body_too_large", "Požiadavka je príliš veľká."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new ApiError(400, "invalid_json", "Obsah požiadavky nie je platný JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "invalid_json", "Očakáva sa JSON objekt.");
  return value as Record<string, unknown>;
}

export function normalizeName(input: unknown): { display: string; normalized: string } {
  if (typeof input !== "string" || input.length > 128) throw new ApiError(422, "invalid_name", "Meno musí mať 3 až 32 znakov.");
  const display = input.normalize("NFKC").trim().replace(/ +/g, " ");
  if (Array.from(display).length < 3 || Array.from(display).length > 32 || !/^[\p{L}\p{N} _-]+$/u.test(display)) throw new ApiError(422, "invalid_name", "Použi 3 až 32 písmen, číslic, medzier, pomlčiek alebo podčiarkovníkov.");
  // Fold per character to avoid context-sensitive final sigma, expand ß, and
  // preserve the distinct Unicode dotless i. NFKC also folds compatibility forms.
  let normalized = display;
  for (let pass = 0; pass < 3; pass++) {
    const folded = Array.from(normalized, (char) => char === "\u0131" ? char : char.toUpperCase().toLowerCase()).join("").normalize("NFKC");
    if (folded === normalized) break;
    normalized = folded;
  }
  return { display, normalized };
}
function passwordValue(input: unknown): string {
  if (typeof input !== "string" || input.length > 256) throw new ApiError(422, "invalid_password", "Heslo musí mať 12 až 128 znakov.");
  const chars = Array.from(input);
  if (chars.length < 12 || chars.length > 128 || chars.some((c) => c.charCodeAt(0) >= 0xd800 && c.charCodeAt(0) <= 0xdfff && c.length === 1)) throw new ApiError(422, "invalid_password", "Heslo musí mať 12 až 128 znakov.");
  return input;
}
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 32, SCRYPT, (error, key) => error ? reject(error) : resolve(key)));
}
export async function hashPassword(password: string): Promise<string> {
  passwordValue(password);
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return "$scrypt$N=32768,r=8,p=3$" + salt.toString("hex") + "$" + key.toString("hex");
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const match = /^\$scrypt\$N=32768,r=8,p=3\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(encoded);
  if (!match) return false;
  const actual = await derive(password, Buffer.from(match[1], "hex"));
  return timingSafeEqual(actual, Buffer.from(match[2], "hex"));
}

export function validateSave(raw: unknown): ReturnType<typeof GameModel.validateState> {
  try { return GameModel.validateState(raw); }
  catch { throw new ApiError(422, "invalid_save", "Herné údaje nie sú platné. Pôvodný cloudový progres zostal zachovaný."); }
}
function serializedSave(state: unknown): string {
  const text = JSON.stringify(state);
  if (encoder.encode(text).byteLength > MAX_BYTES) throw new ApiError(413, "save_too_large", "Záloha presahuje 10 MB. Zmenši obrázky obálok.");
  return text;
}

function devCookie(request: Request, env: AuthEnv): boolean {
  const url = new URL(request.url);
  return (env.DEV === true || env.DEV === "true") && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}
function cookieName(request: Request, env: AuthEnv): string { return devCookie(request, env) ? "mo-session" : "__Host-mo-session"; }
function rawToken(request: Request, env: AuthEnv): string | null {
  const name = cookieName(request, env);
  const values = (request.headers.get("Cookie") || "").split(";").map((v) => v.trim()).filter((v) => v.startsWith(name + "="));
  if (values.length !== 1) return null;
  const token = values[0].slice(name.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}
function sessionCookie(request: Request, env: AuthEnv, token: string, clear = false): string {
  return cookieName(request, env) + "=" + token + "; Path=/; HttpOnly; SameSite=Lax" + (devCookie(request, env) ? "" : "; Secure") + "; Max-Age=" + (clear ? 0 : SESSION_SECONDS) + "; Expires=" + new Date(clear ? 0 : Date.now() + SESSION_SECONDS * 1000).toUTCString();
}
async function sessionRow(request: Request, env: AuthEnv, ownerId: string): Promise<SessionRow | null> {
  const token = rawToken(request, env);
  if (!token) return null;
  return env.DB.prepare("SELECT s.account_id,s.owner_id,s.csrf_value,s.token_hash,a.display_name FROM wizard_sessions s JOIN wizard_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.owner_id=? AND a.owner_id=? AND s.expires_at>?")
    .bind(hash(token), ownerId, ownerId, Date.now()).first<SessionRow>();
}
function accountSession(row: SessionRow): AccountSession {
  return { accountId: row.account_id, ownerId: row.owner_id, name: row.display_name, csrfHash: hash(row.csrf_value), sessionHash: row.token_hash };
}
export async function requireAccount(request: Request, env: AuthEnv): Promise<AccountSession> {
  const ownerId = owner(request, env);
  bindings(env);
  const row = await sessionRow(request, env, ownerId);
  if (!row) throw new ApiError(401, "game_login_required", "Prihlás sa do svojho čarodejníckeho účtu.");
  return accountSession(row);
}

async function savePointer(env: AuthEnv, accountId: string, ownerId: string): Promise<SaveRow> {
  const row = await env.DB.prepare("SELECT s.revision,s.object_key,s.updated_at FROM wizard_saves s JOIN wizard_accounts a ON a.id=s.account_id WHERE s.account_id=? AND a.owner_id=?").bind(accountId, ownerId).first<SaveRow>();
  if (!row) throw new ApiError(503, "save_unavailable", "Cloudový progres sa momentálne nedá načítať.");
  return row;
}
export async function loadSave(env: AuthEnv, accountId: string, ownerId: string) {
  for (let retry = 0; retry < 2; retry++) {
    const row = await savePointer(env, accountId, ownerId);
    const object = await env.BUCKET.get(row.object_key);
    if (!object) continue; // A concurrent save may already have removed the previous object.
    if (object.size > MAX_BYTES) throw new ApiError(503, "save_unavailable", "Cloudový progres sa momentálne nedá načítať.");
    try {
      const state = GameModel.validateState(JSON.parse(await object.text()));
      return { state, revision: row.revision, updatedAt: row.updated_at };
    } catch { throw new ApiError(503, "save_unavailable", "Cloudový progres sa momentálne nedá načítať."); }
  }
  throw new ApiError(503, "save_unavailable", "Cloudový progres sa momentálne nedá načítať.");
}
async function sessionPayload(env: AuthEnv, accountId: string, ownerId: string, name: string, csrf: string) {
  return { account: { id: accountId, name }, csrf, save: await loadSave(env, accountId, ownerId), ...(env.MAGNUM_LOCAL_MODE === "1" ? { localMode: true } : {}) };
}
async function reserveAttempt(env: AuthEnv, ownerId: string, name: string): Promise<string> {
  const key = hash(ownerId + "\u0000" + name);
  const now = Date.now(), cutoff = now - 15 * 60 * 1000;
  const row = await env.DB.prepare("INSERT INTO auth_attempts(bucket_key,window_started_at,attempts) VALUES(?,?,1) ON CONFLICT(bucket_key) DO UPDATE SET attempts=CASE WHEN window_started_at<=? THEN 1 ELSE attempts+1 END,window_started_at=CASE WHEN window_started_at<=? THEN excluded.window_started_at ELSE window_started_at END RETURNING attempts")
    .bind(key, now, cutoff, cutoff).first<{ attempts: number }>();
  if (!row || row.attempts > 5) throw new ApiError(429, "too_many_attempts", "Príliš veľa pokusov. Skús to znova o 15 minút.");
  return key;
}
async function clearAttempt(env: AuthEnv, key: string): Promise<void> { await env.DB.prepare("DELETE FROM auth_attempts WHERE bucket_key=?").bind(key).run(); }
async function deleteUnreferenced(env: AuthEnv, key: string): Promise<void> {
  // A transport error can arrive after D1 committed: never delete a blob unless
  // a subsequent successful database read confirms it has no live pointer.
  try {
    const reference = await env.DB.prepare("SELECT account_id FROM wizard_saves WHERE object_key=?").bind(key).first();
    if (!reference) await env.BUCKET.delete(key);
  } catch { /* Retain an orphan rather than risk deleting a committed save. */ }
}
async function removeOldObject(env: AuthEnv, key: string): Promise<void> { try { await env.BUCKET.delete(key); } catch { /* The committed save remains usable; cleanup may be retried later. */ } }
function sessionMaterial() {
  const token = randomBytes(32).toString("hex"), csrf = randomBytes(32).toString("hex");
  return { token, csrf, tokenHash: hash(token), expiresAt: Date.now() + SESSION_SECONDS * 1000 };
}

async function register(request: Request, env: AuthEnv, ownerId: string): Promise<Response> {
  const body = await readJson(request);
  const name = normalizeName(body.name), password = passwordValue(body.password);
  const existing = await env.DB.prepare("SELECT id FROM wizard_accounts WHERE owner_id=? OR normalized_name=?").bind(ownerId, name.normalized).first();
  if (existing) throw new ApiError(409, "account_exists", "Pre tento ChatGPT účet už čarodej existuje alebo je toto meno obsadené.");
  const attempt = await reserveAttempt(env, ownerId, "registration");
  const state = validateSave(body.initialState === undefined ? GameModel.createState() : body.initialState);
  state.profile.name = name.display;
  const contents = serializedSave(state), passwordHash = await hashPassword(password);
  const accountId = randomUUID(), now = Date.now(), material = sessionMaterial();
  const objectKey = "saves/" + accountId + "/" + randomUUID() + ".json";
  const stored = await env.BUCKET.put(objectKey, contents, { httpMetadata: { contentType: "application/json" } });
  if (!stored) throw new ApiError(503, "save_unavailable", "Účet sa nepodarilo bezpečne uložiť. Skús to znova.");
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO wizard_accounts(id,owner_id,normalized_name,display_name,password_hash,created_at) VALUES(?,?,?,?,?,?)").bind(accountId, ownerId, name.normalized, name.display, passwordHash, now),
      env.DB.prepare("INSERT INTO wizard_saves(account_id,revision,object_key,updated_at) VALUES(?,1,?,?)").bind(accountId, objectKey, now),
      env.DB.prepare("INSERT INTO wizard_sessions(token_hash,account_id,owner_id,csrf_value,expires_at) VALUES(?,?,?,?,?)").bind(material.tokenHash, accountId, ownerId, material.csrf, material.expiresAt),
    ]);
  } catch {
    await deleteUnreferenced(env, objectKey);
    const own = await env.DB.prepare("SELECT id FROM wizard_accounts WHERE id=? AND owner_id=?").bind(accountId, ownerId).first();
    if (!own) {
      const conflict = await env.DB.prepare("SELECT id FROM wizard_accounts WHERE owner_id=? OR normalized_name=?").bind(ownerId, name.normalized).first();
      if (conflict) throw new ApiError(409, "account_exists", "Pre tento ChatGPT účet už čarodej existuje alebo je toto meno obsadené.");
      throw new ApiError(503, "registration_failed", "Účet sa nepodarilo bezpečne uložiť. Skús to znova.");
    }
  }
  await clearAttempt(env, attempt);
  return json(await sessionPayload(env, accountId, ownerId, name.display, material.csrf), 201, { "Set-Cookie": sessionCookie(request, env, material.token) });
}

async function login(request: Request, env: AuthEnv, ownerId: string): Promise<Response> {
  const body = await readJson(request, 4096);
  let name: ReturnType<typeof normalizeName>, password: string;
  try { name = normalizeName(body.name); password = passwordValue(body.password); }
  catch { throw new ApiError(401, "invalid_credentials", "Meno alebo heslo nie je správne."); }
  const attempt = await reserveAttempt(env, ownerId, name.normalized);
  const account = await env.DB.prepare("SELECT id,owner_id,display_name,password_hash FROM wizard_accounts WHERE owner_id=? AND normalized_name=?").bind(ownerId, name.normalized).first<AccountRow>();
  // Derive with the real cost even for unknown names, avoiding a cheap username oracle.
  const dummy = "$scrypt$N=32768,r=8,p=3$00000000000000000000000000000000$" + "00".repeat(32);
  const valid = await verifyPassword(password, account?.password_hash || dummy);
  if (!account || !valid) throw new ApiError(401, "invalid_credentials", "Meno alebo heslo nie je správne.");
  const save = await loadSave(env, account.id, ownerId);
  const material = sessionMaterial(), previous = rawToken(request, env);
  const statements = [];
  if (previous) statements.push(env.DB.prepare("DELETE FROM wizard_sessions WHERE token_hash=? AND account_id=? AND owner_id=?").bind(hash(previous), account.id, ownerId));
  statements.push(env.DB.prepare("INSERT INTO wizard_sessions(token_hash,account_id,owner_id,csrf_value,expires_at) VALUES(?,?,?,?,?)").bind(material.tokenHash, account.id, ownerId, material.csrf, material.expiresAt));
  await env.DB.batch(statements);
  await clearAttempt(env, attempt);
  return json({ account: { id: account.id, name: account.display_name }, csrf: material.csrf, save }, 200, { "Set-Cookie": sessionCookie(request, env, material.token) });
}

async function openPersonalLocal(request: Request, env: AuthEnv): Promise<Response> {
  if (!isPersonalLocal(request, env)) throw new ApiError(404, "not_found", "Táto operácia nie je dostupná.");
  await readJson(request, 4096);
  const current = await sessionRow(request, env, LOCAL_OWNER);
  if (current) {
    verifyCsrf(request, accountSession(current));
    return json(await sessionPayload(env, current.account_id, LOCAL_OWNER, current.display_name, current.csrf_value));
  }
  let account = await env.DB.prepare("SELECT id,owner_id,display_name,password_hash FROM wizard_accounts WHERE owner_id=?").bind(LOCAL_OWNER).first<AccountRow>();
  if (!account) {
    // The generated secret is never sent to a browser or written to disk. The
    // private loopback folder is the access boundary; normal sessions still
    // protect all data routes and CSRF still protects every change.
    try {
      return await register(new Request(request.url, {
        method: "POST", headers: request.headers,
        body: JSON.stringify({ name: "AlwaysDisgusted", password: randomBytes(48).toString("hex") }),
      }), env, LOCAL_OWNER);
    } catch (error) {
      // Two fresh tabs may open together. Reuse the winning folder profile;
      // never create a second identity or replace its already-saved progress.
      if (!(error instanceof ApiError) || error.code !== "account_exists") throw error;
      account = await env.DB.prepare("SELECT id,owner_id,display_name,password_hash FROM wizard_accounts WHERE owner_id=?").bind(LOCAL_OWNER).first<AccountRow>();
      if (!account) throw error;
    }
  }
  const material = sessionMaterial();
  await env.DB.prepare("INSERT INTO wizard_sessions(token_hash,account_id,owner_id,csrf_value,expires_at) VALUES(?,?,?,?,?)")
    .bind(material.tokenHash, account.id, LOCAL_OWNER, material.csrf, material.expiresAt).run();
  return json(await sessionPayload(env, account.id, LOCAL_OWNER, account.display_name, material.csrf), 200, { "Set-Cookie": sessionCookie(request, env, material.token) });
}

async function putSave(request: Request, env: AuthEnv, session: AccountSession): Promise<Response> {
  const body = await readJson(request), revision = body.expectedRevision;
  if (!Number.isSafeInteger(revision) || (revision as number) < 1) throw new ApiError(422, "invalid_revision", "Chýba platná revízia cloudového progresu.");
  const state = validateSave(body.state), contents = serializedSave(state);
  const previous = await savePointer(env, session.accountId, session.ownerId);
  if (previous.revision !== revision) throw new ApiError(409, "save_conflict", "Cloud už obsahuje novší progres. Najprv ho načítaj alebo si exportuj svoje zmeny.");
  const rewards = await env.DB.prepare("SELECT ledger_entry FROM knowledge_term_rewards WHERE account_id=?")
    .bind(session.accountId).all<{ ledger_entry: string }>();
  const termEntries = state.ledger.filter((item: { type: string }) => item.type === "knowledge-term");
  if (termEntries.length !== rewards.results.length || rewards.results.some(row => {
    const receipt = JSON.parse(row.ledger_entry) as Record<string, unknown>;
    return !termEntries.some((item: Record<string, unknown>) =>
      Object.keys(receipt).every(key => item[key] === receipt[key]));
  })) {
    throw new ApiError(409, "term_reward_conflict", "Odmeny za terminológiu nesúhlasia so serverom. Zachovaj koncept a načítaj uložený progres.");
  }
  const readingRewards = await env.DB.prepare("SELECT ledger_entry FROM knowledge_reading_turns WHERE account_id=? AND ledger_entry IS NOT NULL")
    .bind(session.accountId).all<{ ledger_entry: string }>();
  const readingEntries = state.ledger.filter((item: { type: string }) => item.type === "grimoire-reading");
  if (readingEntries.length !== readingRewards.results.length || readingRewards.results.some(row => {
    const receipt = JSON.parse(row.ledger_entry) as Record<string, unknown>;
    return !readingEntries.some((item: Record<string, unknown>) => Object.keys(receipt).every(key => item[key] === receipt[key]));
  })) throw new ApiError(409, "reading_reward_conflict", "Odmeny za listovanie nesúhlasia so serverom. Koncept zostal zachovaný; načítaj uložený progres.");
  const objectKey = "saves/" + session.accountId + "/" + randomUUID() + ".json", updatedAt = Date.now();
  const stored = await env.BUCKET.put(objectKey, contents, { httpMetadata: { contentType: "application/json" } });
  if (!stored) throw new ApiError(503, "save_unavailable", "Progres sa nepodarilo uložiť.");
  try {
    const result = await env.DB.prepare("UPDATE wizard_saves SET revision=revision+1,object_key=?,updated_at=? WHERE account_id=? AND revision=? AND EXISTS(SELECT 1 FROM wizard_accounts a WHERE a.id=wizard_saves.account_id AND a.owner_id=?)")
      .bind(objectKey, updatedAt, session.accountId, revision, session.ownerId).run();
    if (result.meta.changes !== 1) {
      await deleteUnreferenced(env, objectKey);
      throw new ApiError(409, "save_conflict", "Cloud už obsahuje novší progres. Najprv ho načítaj alebo si exportuj svoje zmeny.");
    }
  } catch (error) {
    await deleteUnreferenced(env, objectKey);
    throw error;
  }
  await removeOldObject(env, previous.object_key);
  return json({ revision: (revision as number) + 1, updatedAt });
}

export async function handleAuth(request: Request, env: AuthEnv): Promise<Response | null> {
  const route = new URL(request.url).pathname;
  if (!["/api/auth/session", "/api/auth/register", "/api/auth/login", "/api/auth/local", "/api/auth/logout", "/api/save"].includes(route)) return null;
  try {
    guardPersonalContext(request, env);
    if (route === "/api/auth/session" && request.method === "GET") {
      if (!isPersonalLocal(request, env) && !request.headers.get("oai-authenticated-user-id")) return json({ account: null, requiresSiteLogin: true });
      const ownerId = owner(request, env); bindings(env);
      const session = await sessionRow(request, env, ownerId);
      if (session) return json(await sessionPayload(env, session.account_id, ownerId, session.display_name, session.csrf_value));
      const exists = await env.DB.prepare("SELECT id FROM wizard_accounts WHERE owner_id=?").bind(ownerId).first();
      return json({ account: null, requiresSiteLogin: false, hasAccount: !!exists, ...(isPersonalLocal(request, env) ? { localMode: true } : {}) });
    }
    if (route === "/api/auth/local" && !isPersonalLocal(request, env)) throw new ApiError(404, "not_found", "Táto operácia nie je dostupná.");
    const ownerId = owner(request, env); bindings(env);
    if (["POST", "PUT", "DELETE", "PATCH"].includes(request.method)) guardWrite(request);
    if (route === "/api/auth/local" && request.method === "POST") return await openPersonalLocal(request, env);
    if ((route === "/api/auth/register" || route === "/api/auth/login") && request.method === "POST") {
      if (isPersonalLocal(request, env)) throw new ApiError(403, "personal_profile_only", "Táto zložka používa jeden lokálny profil.");
      const existing = await sessionRow(request, env, ownerId);
      if (existing) verifyCsrf(request, accountSession(existing));
      return route === "/api/auth/register" ? await register(request, env, ownerId) : await login(request, env, ownerId);
    }
    if (route === "/api/save" && ["GET", "PUT"].includes(request.method)) {
      const session = await requireAccount(request, env);
      if (request.method === "GET") return json(await loadSave(env, session.accountId, session.ownerId));
      verifyCsrf(request, session);
      return await putSave(request, env, session);
    }
    if (route === "/api/auth/logout" && request.method === "POST") {
      const session = await requireAccount(request, env); verifyCsrf(request, session);
      await env.DB.prepare("DELETE FROM wizard_sessions WHERE token_hash=? AND account_id=? AND owner_id=?").bind(session.sessionHash, session.accountId, session.ownerId).run();
      return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(request, env, "", true) });
    }
    throw new ApiError(405, "method_not_allowed", "Táto operácia nie je podporovaná.");
  } catch (error) {
    const api = error instanceof ApiError ? error : new ApiError(503, "service_unavailable", "Služba momentálne nie je dostupná. Tvoje lokálne zmeny zostali zachované.");
    return json({ error: { code: api.code, message: api.message } }, api.status);
  }
}
