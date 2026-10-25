import { randomUUID } from "node:crypto";
import StudyModel from "./study-model.mjs";
import { ApiError, guardWrite, json, readJson, requireAccount, verifyCsrf } from "./auth";
import type { AccountSession, AuthEnv } from "./auth";

const MAX_BYTES = 10 * 1024 * 1024;
const encoder = new TextEncoder();
interface StudyPointer { revision: number; object_key: string; updated_at: number }
async function pointer(env: AuthEnv, session: AccountSession): Promise<StudyPointer | null> {
  return env.DB.prepare("SELECT d.revision,d.object_key,d.updated_at FROM personal_study d JOIN wizard_accounts a ON a.id=d.account_id WHERE d.account_id=? AND a.owner_id=?")
    .bind(session.accountId, session.ownerId).first<StudyPointer>();
}
function unavailable(): ApiError {
  return new ApiError(503, "study_unavailable", "Osobné štúdium sa momentálne nedá načítať alebo uložiť. Tvoje zmeny zostali v prehliadači.");
}
function conflict(): ApiError {
  return new ApiError(409, "study_conflict", "Osobné štúdium sa zmenilo v inom okne. Najprv načítaj uloženú verziu alebo exportuj svoje zmeny.");
}
async function loadStudy(env: AuthEnv, session: AccountSession) {
  for (let retry = 0; retry < 2; retry++) {
    const row = await pointer(env, session);
    if (!row) return { state: StudyModel.createState(), revision: 0, updatedAt: null };
    const object = await env.BUCKET.get(row.object_key);
    if (!object) continue;
    if (object.size > MAX_BYTES) throw unavailable();
    try {
      const state = StudyModel.validateState(JSON.parse(await object.text()));
      return { state, revision: row.revision, updatedAt: row.updated_at };
    } catch { throw unavailable(); }
  }
  throw unavailable();
}
async function deleteUnreferenced(env: AuthEnv, key: string): Promise<void> {
  // A committed write may still report a transport failure; never remove a blob
  // unless a fresh successful read proves no live pointer references it.
  try {
    const reference = await env.DB.prepare("SELECT account_id FROM personal_study WHERE object_key=?").bind(key).first();
    if (!reference) await env.BUCKET.delete(key);
  } catch { /* Retain a possible orphan rather than deleting committed notes. */ }
}
async function putStudy(request: Request, env: AuthEnv, session: AccountSession): Promise<Response> {
  const body = await readJson(request, MAX_BYTES + 1024);
  const revision = body.expectedRevision;
  if (!Number.isSafeInteger(revision) || (revision as number) < 0 || (revision as number) >= Number.MAX_SAFE_INTEGER) throw new ApiError(422, "invalid_revision", "Chýba platná revízia osobného štúdia.");
  let state: ReturnType<typeof StudyModel.validateState>;
  try { state = StudyModel.validateState(body.state); }
  catch { throw new ApiError(422, "invalid_study", "Údaje osobného štúdia nie sú platné. Pôvodné poznámky zostali zachované."); }
  const contents = JSON.stringify(state);
  if (encoder.encode(contents).byteLength > MAX_BYTES) throw new ApiError(413, "study_too_large", "Osobné štúdium presahuje 10 MB. Zmenši vložené obrázky.");
  const previous = await pointer(env, session);
  if ((previous?.revision ?? 0) !== revision) throw conflict();
  const objectKey = "study/" + session.accountId + "/" + randomUUID() + ".json";
  const updatedAt = Date.now();
  const stored = await env.BUCKET.put(objectKey, contents, { httpMetadata: { contentType: "application/json" } });
  if (!stored) throw unavailable();
  try {
    const result = revision === 0
      ? await env.DB.prepare("INSERT INTO personal_study(account_id,revision,object_key,updated_at) SELECT ?,1,?,? WHERE EXISTS(SELECT 1 FROM wizard_accounts WHERE id=? AND owner_id=?) ON CONFLICT(account_id) DO NOTHING")
        .bind(session.accountId, objectKey, updatedAt, session.accountId, session.ownerId).run()
      : await env.DB.prepare("UPDATE personal_study SET revision=revision+1,object_key=?,updated_at=? WHERE account_id=? AND revision=? AND EXISTS(SELECT 1 FROM wizard_accounts a WHERE a.id=personal_study.account_id AND a.owner_id=?)")
        .bind(objectKey, updatedAt, session.accountId, revision, session.ownerId).run();
    if (result.meta.changes !== 1) throw conflict();
  } catch (error) { await deleteUnreferenced(env, objectKey); throw error; }
  if (previous) await deleteUnreferenced(env, previous.object_key);
  return json({ revision: (revision as number) + 1, updatedAt });
}
export async function handleStudy(request: Request, env: AuthEnv): Promise<Response | null> {
  if (new URL(request.url).pathname !== "/api/study") return null;
  try {
    const session = await requireAccount(request, env);
    if (request.method === "GET") return json(await loadStudy(env, session));
    if (request.method === "PUT") { guardWrite(request); verifyCsrf(request, session); return await putStudy(request, env, session); }
    throw new ApiError(405, "method_not_allowed", "Táto operácia nie je podporovaná.");
  } catch (error) {
    const api = error instanceof ApiError ? error : unavailable();
    return json({ error: { code: api.code, message: api.message } }, api.status);
  }
}
