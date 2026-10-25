import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { ApiError, guardWrite, json, readJson, requireAccount, verifyCsrf } from "./auth";
import type { AccountSession, AuthEnv } from "./auth";

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_CATEGORIES = 100;
const MAX_CATEGORY_PHOTOS = 300;
const MAX_ACCOUNT_PHOTOS = 2000;
interface CategoryRow { id: string; name: string; revision: number; created_at: number; photo_count: number }
interface PhotoRow { id: string; caption: string; object_key: string; mime: string; byte_length: number; width: number; height: number; created_at: number }
interface PhotoIndexRow { id: string; category_id: string; category_name: string; caption: string }

function unavailable() { return new ApiError(503, "library_unavailable", "Knižnica sa momentálne nedá načítať alebo uložiť. Skús to znova."); }
function notFound() { return new ApiError(404, "library_not_found", "Táto kategória alebo fotografia nie je dostupná."); }
function nameValue(raw: unknown) {
  if (typeof raw !== "string" || raw.length > 320) throw new ApiError(422, "invalid_category_name", "Názov kategórie musí mať 1 až 80 znakov.");
  const name = raw.normalize("NFKC").trim().replace(/ +/g, " ");
  if (!name || Array.from(name).length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw new ApiError(422, "invalid_category_name", "Názov kategórie musí mať 1 až 80 znakov.");
  return { name, normalized: name.toLocaleLowerCase("sk") };
}
function captionValue(raw: unknown) {
  if (raw === undefined) return "";
  if (typeof raw !== "string" || Array.from(raw).length > 300 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)) throw new ApiError(422, "invalid_caption", "Popis fotografie môže mať najviac 300 znakov.");
  return raw.trim();
}
function imageError() { return new ApiError(422, "invalid_photo", "Vyber platnú fotografiu PNG, JPEG alebo WebP do 2 MB."); }
function validSize(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 20000 || height > 20000 || width * height > 40000000) throw imageError();
  return { width, height };
}
function dimensions(bytes: Buffer, mime: string) {
  if (mime === "image/png") {
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") throw imageError();
    return validSize(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  }
  if (mime === "image/jpeg") {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) throw imageError();
    let offset = 2;
    while (offset < bytes.length - 2) {
      if (bytes[offset++] !== 0xff) throw imageError();
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) throw imageError();
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8) throw imageError();
        return validSize(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
      }
      offset += length;
    }
    throw imageError();
  }
  if (bytes.length < 25 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP" || bytes.readUInt32LE(4) + 8 !== bytes.length) throw imageError();
  const chunk = bytes.toString("ascii", 12, 16), chunkLength = bytes.readUInt32LE(16);
  if (chunkLength + 20 > bytes.length) throw imageError();
  if (chunk === "VP8X" && chunkLength >= 10) return validSize(1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3));
  if (chunk === "VP8 " && chunkLength >= 10 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return validSize(bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff);
  if (chunk === "VP8L" && chunkLength >= 5 && bytes[20] === 0x2f) return validSize(1 + bytes[21] + ((bytes[22] & 0x3f) << 8), 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10));
  throw imageError();
}
function imageValue(raw: unknown) {
  if (typeof raw !== "string" || raw.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 40) throw new ApiError(413, "photo_too_large", "Fotografia môže mať najviac 2 MB.");
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(raw);
  if (!match || match[2].length % 4 !== 0) throw imageError();
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new ApiError(413, "photo_too_large", "Fotografia môže mať najviac 2 MB.");
  if (bytes.toString("base64") !== match[2]) throw imageError();
  return { bytes, mime: match[1], ...dimensions(bytes, match[1]) };
}
function categoryPayload(row: CategoryRow) { return { id: row.id, name: row.name, revision: row.revision, photoCount: row.photo_count, createdAt: row.created_at }; }
function photoPayload(row: PhotoRow) { return { id: row.id, caption: row.caption, url: "/api/library/photos/" + row.id, width: row.width, height: row.height, createdAt: row.created_at }; }
const CATEGORY_SELECT = "SELECT c.id,c.name,c.revision,c.created_at,(SELECT count(*) FROM library_photos p WHERE p.category_id=c.id AND p.account_id=c.account_id) AS photo_count FROM library_categories c JOIN wizard_accounts a ON a.id=c.account_id WHERE c.account_id=? AND a.owner_id=?";
async function category(env: AuthEnv, session: AccountSession, id: string) {
  const row = await env.DB.prepare(CATEGORY_SELECT + " AND c.id=?").bind(session.accountId, session.ownerId, id).first<CategoryRow>();
  if (!row) throw notFound();
  return row;
}
async function photo(env: AuthEnv, session: AccountSession, id: string) {
  const row = await env.DB.prepare("SELECT p.id,p.caption,p.object_key,p.mime,p.byte_length,p.width,p.height,p.created_at FROM library_photos p JOIN library_categories c ON c.id=p.category_id AND c.account_id=p.account_id JOIN wizard_accounts a ON a.id=p.account_id WHERE p.id=? AND p.account_id=? AND a.owner_id=?")
    .bind(id, session.accountId, session.ownerId).first<PhotoRow>();
  if (!row) throw notFound();
  return row;
}
async function deleteUnreferenced(env: AuthEnv, objectKey: string) {
  try {
    const reference = await env.DB.prepare("SELECT id FROM library_photos WHERE object_key=?").bind(objectKey).first();
    if (!reference) await env.BUCKET.delete(objectKey);
  } catch { /* Keep a possible orphan rather than remove a committed photo. */ }
}
async function createCategory(request: Request, env: AuthEnv, session: AccountSession) {
  const body = await readJson(request, 2048), value = nameValue(body.name);
  const existing = await env.DB.prepare("SELECT id FROM library_categories WHERE account_id=? AND normalized_name=?").bind(session.accountId, value.normalized).first();
  if (existing) throw new ApiError(409, "category_name_exists", "Kategória s týmto názvom už existuje.");
  const id = randomUUID(), now = Date.now();
  const result = await env.DB.prepare("INSERT INTO library_categories(id,account_id,name,normalized_name,revision,created_at) SELECT ?,?,?,?,1,? WHERE EXISTS(SELECT 1 FROM wizard_accounts WHERE id=? AND owner_id=?) AND (SELECT count(*) FROM library_categories WHERE account_id=?)<? ON CONFLICT DO NOTHING")
    .bind(id, session.accountId, value.name, value.normalized, now, session.accountId, session.ownerId, session.accountId, MAX_CATEGORIES).run();
  if (result.meta.changes !== 1) throw new ApiError(409, "category_limit", "Kategóriu sa nepodarilo pridať. Najviac môžeš mať 100 kategórií a ich názvy musia byť odlišné.");
  return json({ category: categoryPayload(await category(env, session, id)) }, 201);
}
async function renameCategory(request: Request, env: AuthEnv, session: AccountSession, id: string) {
  const body = await readJson(request, 2048), value = nameValue(body.name);
  if (!Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 1 || (body.expectedRevision as number) >= Number.MAX_SAFE_INTEGER) throw new ApiError(422, "invalid_revision", "Chýba platná revízia kategórie.");
  await category(env, session, id);
  const duplicate = await env.DB.prepare("SELECT id FROM library_categories WHERE account_id=? AND normalized_name=? AND id<>?").bind(session.accountId, value.normalized, id).first();
  if (duplicate) throw new ApiError(409, "category_name_exists", "Kategória s týmto názvom už existuje.");
  const result = await env.DB.prepare("UPDATE library_categories SET name=?,normalized_name=?,revision=revision+1 WHERE id=? AND account_id=? AND revision=? AND EXISTS(SELECT 1 FROM wizard_accounts WHERE id=? AND owner_id=?) AND NOT EXISTS(SELECT 1 FROM library_categories other WHERE other.account_id=? AND other.normalized_name=? AND other.id<>?)")
    .bind(value.name, value.normalized, id, session.accountId, body.expectedRevision, session.accountId, session.ownerId, session.accountId, value.normalized, id).run();
  if (result.meta.changes !== 1) throw new ApiError(409, "category_conflict", "Kategória sa zmenila v inom okne. Načítaj ju znova.");
  return json({ category: categoryPayload(await category(env, session, id)) });
}
async function uploadPhoto(request: Request, env: AuthEnv, session: AccountSession, categoryId: string) {
  await category(env, session, categoryId);
  const body = await readJson(request, 3 * 1024 * 1024), caption = captionValue(body.caption), image = imageValue(body.image);
  const id = randomUUID(), createdAt = Date.now(), objectKey = "library/" + session.accountId + "/" + categoryId + "/" + id;
  const stored = await env.BUCKET.put(objectKey, image.bytes, { httpMetadata: { contentType: image.mime } });
  if (!stored) throw unavailable();
  try {
    const result = await env.DB.prepare("INSERT INTO library_photos(id,category_id,account_id,caption,object_key,mime,byte_length,width,height,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM library_categories c JOIN wizard_accounts a ON a.id=c.account_id WHERE c.id=? AND c.account_id=? AND a.owner_id=?) AND (SELECT count(*) FROM library_photos WHERE category_id=? AND account_id=?)<? AND (SELECT count(*) FROM library_photos WHERE account_id=?)<?")
      .bind(id, categoryId, session.accountId, caption, objectKey, image.mime, image.bytes.length, image.width, image.height, createdAt, categoryId, session.accountId, session.ownerId, categoryId, session.accountId, MAX_CATEGORY_PHOTOS, session.accountId, MAX_ACCOUNT_PHOTOS).run();
    if (result.meta.changes !== 1) throw new ApiError(409, "photo_limit", "Kategória môže mať najviac 300 fotografií a celý účet 2 000 fotografií.");
  } catch (error) { await deleteUnreferenced(env, objectKey); throw error; }
  return json({ photo: photoPayload(await photo(env, session, id)) }, 201);
}
export async function handleLibraryCategories(request: Request, env: AuthEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const collection = path === "/api/library/categories", photoIndex = path === "/api/library/photos", categoryRoute = /^\/api\/library\/categories\/([a-f0-9-]{36})$/.exec(path), photos = /^\/api\/library\/categories\/([a-f0-9-]{36})\/photos$/.exec(path), image = /^\/api\/library\/photos\/([a-f0-9-]{36})$/.exec(path);
  if (!collection && !photoIndex && !categoryRoute && !photos && !image) return null;
  try {
    const session = await requireAccount(request, env);
    if (request.method !== "GET") { guardWrite(request); verifyCsrf(request, session); }
    if (collection && request.method === "GET") {
      const rows = await env.DB.prepare(CATEGORY_SELECT + " ORDER BY c.created_at,c.id").bind(session.accountId, session.ownerId).all<CategoryRow>();
      return json({ categories: rows.results.map(categoryPayload) });
    }
    if (collection && request.method === "POST") return await createCategory(request, env, session);
    if (categoryRoute && request.method === "PATCH") return await renameCategory(request, env, session, categoryRoute[1]);
    if (photoIndex && request.method === "GET") {
      const rows = await env.DB.prepare("SELECT p.id,p.category_id,c.name AS category_name,p.caption FROM library_photos p JOIN library_categories c ON c.id=p.category_id AND c.account_id=p.account_id JOIN wizard_accounts a ON a.id=p.account_id WHERE p.account_id=? AND a.owner_id=? ORDER BY p.created_at,p.id LIMIT ?")
        .bind(session.accountId, session.ownerId, MAX_ACCOUNT_PHOTOS).all<PhotoIndexRow>();
      return json({ photos: rows.results.filter(row => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(row.id)).map(row => ({ id: row.id, categoryId: row.category_id, categoryName: row.category_name, caption: row.caption, url: "/api/library/photos/" + row.id })) });
    }
    if (photos && request.method === "GET") {
      await category(env, session, photos[1]);
      const rows = await env.DB.prepare("SELECT id,caption,width,height,created_at FROM library_photos WHERE category_id=? AND account_id=? ORDER BY created_at,id").bind(photos[1], session.accountId).all<PhotoRow>();
      return json({ photos: rows.results.map(photoPayload) });
    }
    if (photos && request.method === "POST") return await uploadPhoto(request, env, session, photos[1]);
    if (image && request.method === "GET") {
      const row = await photo(env, session, image[1]), object = await env.BUCKET.get(row.object_key);
      if (!object || object.size !== row.byte_length || object.size > MAX_IMAGE_BYTES) throw unavailable();
      return new Response(object.body, { headers: { "Content-Type": row.mime, "Cache-Control": "no-store, private", "Pragma": "no-cache", "Vary": "Cookie", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" } });
    }
    if (image && request.method === "DELETE") {
      const row = await photo(env, session, image[1]);
      const result = await env.DB.prepare("DELETE FROM library_photos WHERE id=? AND account_id=? AND EXISTS(SELECT 1 FROM wizard_accounts WHERE id=? AND owner_id=?)").bind(image[1], session.accountId, session.accountId, session.ownerId).run();
      if (result.meta.changes !== 1) throw notFound();
      await deleteUnreferenced(env, row.object_key);
      return json({ ok: true });
    }
    throw new ApiError(405, "method_not_allowed", "Táto operácia nie je podporovaná.");
  } catch (error) {
    const api = error instanceof ApiError ? error : unavailable();
    return json({ error: { code: api.code, message: api.message } }, api.status);
  }
}
