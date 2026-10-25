import { randomUUID } from "node:crypto";
import DeskModel from "./desk-model.mjs";
import { ApiError, guardWrite, json, readJson, requireAccount, verifyCsrf } from "./auth";
import type { AccountSession, AuthEnv } from "./auth";

const MAX_BYTES = 10 * 1024 * 1024;
const encoder = new TextEncoder();
interface DeskPointer { revision: number; object_key: string; updated_at: number }

async function pointer(env: AuthEnv, session: AccountSession): Promise<DeskPointer | null> {
  return env.DB.prepare("SELECT d.revision,d.object_key,d.updated_at FROM alchemy_desks d JOIN wizard_accounts a ON a.id=d.account_id WHERE d.account_id=? AND a.owner_id=?")
    .bind(session.accountId, session.ownerId).first<DeskPointer>();
}

function unavailable(): ApiError {
  return new ApiError(503, "desk_unavailable", "Alchymistický stôl sa momentálne nedá načítať alebo uložiť. Tvoje zmeny zostali v prehliadači.");
}
function conflict(): ApiError {
  return new ApiError(409, "desk_conflict", "Cloud už obsahuje novšiu verziu stola. Najprv ju načítaj alebo exportuj svoje zmeny.");
}

async function loadDesk(env: AuthEnv, session: AccountSession) {
  for (let retry = 0; retry < 2; retry++) {
    const row = await pointer(env, session);
    if (!row) return { state: DeskModel.createState(), revision: 0, updatedAt: null };
    const object = await env.BUCKET.get(row.object_key);
    // A concurrent save may remove the old blob after this request read its pointer.
    if (!object) continue;
    if (object.size > MAX_BYTES) throw unavailable();
    try {
      const state = DeskModel.validateState(JSON.parse(await object.text()));
      return { state, revision: row.revision, updatedAt: row.updated_at };
    } catch { throw unavailable(); }
  }
  throw unavailable();
}

async function deleteUnreferenced(env: AuthEnv, key: string): Promise<void> {
  // D1 can commit before a transport error reaches the caller. Retain the blob
  // unless a subsequent successful read proves no live desk references it.
  try {
    const reference = await env.DB.prepare("SELECT account_id FROM alchemy_desks WHERE object_key=?").bind(key).first();
    if (!reference) await env.BUCKET.delete(key);
  } catch { /* An orphan is safer than deleting a committed desk. */ }
}

async function putDesk(request: Request, env: AuthEnv, session: AccountSession): Promise<Response> {
  // Leave room for the revision and JSON envelope around a valid 10 MiB state.
  const body = await readJson(request, MAX_BYTES + 1024);
  const revision = body.expectedRevision;
  if (!Number.isSafeInteger(revision) || (revision as number) < 0 || (revision as number) >= Number.MAX_SAFE_INTEGER) {
    throw new ApiError(422, "invalid_revision", "Chýba platná revízia alchymistického stola.");
  }
  let state: ReturnType<typeof DeskModel.validateState>;
  try { state = DeskModel.validateState(body.state); }
  catch { throw new ApiError(422, "invalid_desk", "Údaje stola nie sú platné. Pôvodný cloudový stôl zostal zachovaný."); }
  const contents = JSON.stringify(state);
  if (encoder.encode(contents).byteLength > MAX_BYTES) throw new ApiError(413, "desk_too_large", "Stôl presahuje 10 MB. Zmenši vložené obrázky.");
  const previous = await pointer(env, session);
  if ((previous?.revision ?? 0) !== revision) throw conflict();
  const objectKey = "desks/" + session.accountId + "/" + randomUUID() + ".json";
  const updatedAt = Date.now();
  const stored = await env.BUCKET.put(objectKey, contents, { httpMetadata: { contentType: "application/json" } });
  if (!stored) throw unavailable();
  try {
    const result = revision === 0
      ? await env.DB.prepare("INSERT INTO alchemy_desks(account_id,revision,object_key,updated_at) SELECT ?,1,?,? WHERE EXISTS(SELECT 1 FROM wizard_accounts WHERE id=? AND owner_id=?) ON CONFLICT(account_id) DO NOTHING")
        .bind(session.accountId, objectKey, updatedAt, session.accountId, session.ownerId).run()
      : await env.DB.prepare("UPDATE alchemy_desks SET revision=revision+1,object_key=?,updated_at=? WHERE account_id=? AND revision=? AND EXISTS(SELECT 1 FROM wizard_accounts a WHERE a.id=alchemy_desks.account_id AND a.owner_id=?)")
        .bind(objectKey, updatedAt, session.accountId, revision, session.ownerId).run();
    if (result.meta.changes !== 1) throw conflict();
  } catch (error) {
    await deleteUnreferenced(env, objectKey);
    throw error;
  }
  if (previous) await deleteUnreferenced(env, previous.object_key);
  return json({ revision: (revision as number) + 1, updatedAt });
}

export async function handleDesk(request: Request, env: AuthEnv): Promise<Response | null> {
  if (new URL(request.url).pathname !== "/api/desk") return null;
  try {
    const session = await requireAccount(request, env);
    if (request.method === "GET") return json(await loadDesk(env, session));
    if (request.method === "PUT") {
      guardWrite(request);
      verifyCsrf(request, session);
      return await putDesk(request, env, session);
    }
    throw new ApiError(405, "method_not_allowed", "Táto operácia nie je podporovaná.");
  } catch (error) {
    const api = error instanceof ApiError ? error : unavailable();
    return json({ error: { code: api.code, message: api.message } }, api.status);
  }
}
