import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { inflateRawSync } from "node:zlib";
import KnowledgeModel from "./knowledge-model.mjs";
import { ApiError, guardWrite, json, readJson, requireAccount, verifyCsrf } from "./auth";
import type { AccountSession, AuthEnv } from "./auth";

const MAX_INDEX_BYTES = 20 * 1024 * 1024;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_FORM_BYTES = MAX_FILE_BYTES + 64 * 1024;
const encoder = new TextEncoder();
const UUID = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const MIME_BY_EXTENSION: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", txt: "text/plain", md: "text/markdown" };
interface Pointer { revision: number; object_key: string; updated_at: number }
interface FileRow { id: string; name: string; mime: string; byte_length: number; object_key: string; created_at: number }
function unavailable() { return new ApiError(503, "knowledge_unavailable", "Znalostná mapa sa momentálne nedá načítať alebo uložiť. Zmeny si ponechaj otvorené."); }
function conflict() { return new ApiError(409, "knowledge_conflict", "Znalostná mapa sa zmenila v inom okne. Najprv načítaj uloženú verziu."); }
function invalidFile() { return new ApiError(422, "invalid_knowledge_file", "Vyber platný PNG, JPEG, WebP, PDF, DOCX, TXT alebo MD súbor do 15 MB."); }
function notFound() { return new ApiError(404, "knowledge_file_not_found", "Tento súkromný súbor nie je dostupný."); }
async function pointer(env: AuthEnv, session: AccountSession) {
  return env.DB.prepare("SELECT k.revision,k.object_key,k.updated_at FROM knowledge_maps k JOIN wizard_accounts a ON a.id=k.account_id WHERE k.account_id=? AND a.owner_id=?")
    .bind(session.accountId, session.ownerId).first<Pointer>();
}
async function file(env: AuthEnv, session: AccountSession, id: string) {
  const row = await env.DB.prepare("SELECT f.id,f.name,f.mime,f.byte_length,f.object_key,f.created_at FROM knowledge_files f JOIN wizard_accounts a ON a.id=f.account_id WHERE f.id=? AND f.account_id=? AND a.owner_id=?")
    .bind(id, session.accountId, session.ownerId).first<FileRow>();
  if (!row) throw notFound();
  return row;
}
async function deleteUnreferenced(env: AuthEnv, key: string, table: "knowledge_maps" | "knowledge_files") {
  // D1 may have committed even when its response failed. A successful fresh
  // reference read is required before removing an object from private storage.
  try {
    const reference = await env.DB.prepare("SELECT " + (table === "knowledge_maps" ? "account_id" : "id") + " FROM " + table + " WHERE object_key=?").bind(key).first();
    if (!reference) await env.BUCKET.delete(key);
  } catch { /* Retain a possible orphan rather than delete a committed file. */ }
}
async function loadMap(env: AuthEnv, session: AccountSession) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const row = await pointer(env, session);
    if (!row) return { state: KnowledgeModel.createState(), revision: 0, updatedAt: null };
    const object = await env.BUCKET.get(row.object_key);
    if (!object) continue;
    if (object.size > MAX_INDEX_BYTES) throw unavailable();
    try { return { state: KnowledgeModel.validateState(JSON.parse(await object.text())), revision: row.revision, updatedAt: row.updated_at }; }
    catch { throw unavailable(); }
  }
  throw unavailable();
}
async function verifyAssets(state: ReturnType<typeof KnowledgeModel.validateState>, env: AuthEnv, session: AccountSession) {
  const ids = [...new Set(state.resources.map(resource => resource.assetId).filter((id): id is string => id !== null))];
  // Chunk the ownership query below D1's bound-parameter limit. There are no
  // client-selected bucket paths, external URLs, or cross-account file IDs.
  for (let start = 0; start < ids.length; start += 80) {
    const chunk = ids.slice(start, start + 80);
    const rows = await env.DB.prepare("SELECT f.id,f.mime FROM knowledge_files f JOIN wizard_accounts a ON a.id=f.account_id WHERE f.account_id=? AND a.owner_id=? AND f.id IN (" + chunk.map(() => "?").join(",") + ")")
      .bind(session.accountId, session.ownerId, ...chunk).all<{ id: string; mime: string }>();
    if (rows.results.length !== chunk.length) throw new ApiError(422, "invalid_knowledge_asset", "Znalostná mapa odkazuje na nedostupný súkromný súbor.");
    const mimes = new Map(rows.results.map(row => [row.id, row.mime]));
    for (const resource of state.resources) if (resource.assetId && mimes.has(resource.assetId) && resource.mime !== mimes.get(resource.assetId)) throw new ApiError(422, "invalid_knowledge_asset", "Typ pripojeného súboru nezodpovedá uloženému originálu.");
  }
}
async function putMap(request: Request, env: AuthEnv, session: AccountSession) {
  const body = await readJson(request, MAX_INDEX_BYTES + 1024), revision = body.expectedRevision;
  if (!Number.isSafeInteger(revision) || (revision as number) < 0 || (revision as number) >= Number.MAX_SAFE_INTEGER) throw new ApiError(422, "invalid_revision", "Chýba platná revízia znalostnej mapy.");
  let state: ReturnType<typeof KnowledgeModel.validateState>;
  try { state = KnowledgeModel.validateState(body.state); }
  catch { throw new ApiError(422, "invalid_knowledge", "Údaje znalostnej mapy nie sú platné. Uložená verzia zostala zachovaná."); }
  const contents = JSON.stringify(state);
  if (encoder.encode(contents).byteLength > MAX_INDEX_BYTES) throw new ApiError(413, "knowledge_too_large", "Znalostná mapa presahuje 20 MB.");
  const previous = await pointer(env, session);
  if ((previous?.revision ?? 0) !== revision) throw conflict();
  await verifyAssets(state, env, session);
  const key = "knowledge/" + session.accountId + "/maps/" + randomUUID() + ".json", updatedAt = Date.now();
  const stored = await env.BUCKET.put(key, contents, { httpMetadata: { contentType: "application/json" } });
  if (!stored) throw unavailable();
  try {
    const result = revision === 0
      ? await env.DB.prepare("INSERT INTO knowledge_maps(account_id,revision,object_key,updated_at) SELECT ?,1,?,? WHERE EXISTS(SELECT 1 FROM wizard_accounts WHERE id=? AND owner_id=?) ON CONFLICT(account_id) DO NOTHING").bind(session.accountId, key, updatedAt, session.accountId, session.ownerId).run()
      : await env.DB.prepare("UPDATE knowledge_maps SET revision=revision+1,object_key=?,updated_at=? WHERE account_id=? AND revision=? AND EXISTS(SELECT 1 FROM wizard_accounts a WHERE a.id=knowledge_maps.account_id AND a.owner_id=?)").bind(key, updatedAt, session.accountId, revision, session.ownerId).run();
    if (result.meta.changes !== 1) throw conflict();
  } catch (error) { await deleteUnreferenced(env, key, "knowledge_maps"); throw error; }
  if (previous) await deleteUnreferenced(env, previous.object_key, "knowledge_maps");
  return json({ revision: (revision as number) + 1, updatedAt });
}
function rasterDimensions(bytes: Buffer, mime: string) {
  function dimensions(width: number, height: number) {
    if (width < 1 || height < 1 || width > 20000 || height > 20000 || width * height > 40000000) throw invalidFile();
  }
  if (mime === "image/png") {
    if (bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw invalidFile();
    let offset = 8, data = false, first = true;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset), kind = bytes.toString("ascii", offset + 4, offset + 8);
      if (length > bytes.length - offset - 12 || !/^[A-Za-z]{4}$/.test(kind)) throw invalidFile();
      if (first) { if (kind !== "IHDR" || length !== 13) throw invalidFile(); dimensions(bytes.readUInt32BE(offset + 8), bytes.readUInt32BE(offset + 12)); first = false; }
      if (kind === "IDAT" && length) data = true;
      offset += length + 12;
      if (kind === "IEND") { if (length || !data || offset !== bytes.length) throw invalidFile(); return; }
    }
    throw invalidFile();
  }
  if (mime === "image/jpeg") {
    if (bytes.length < 15 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) throw invalidFile();
    let offset = 2, found = false;
    while (offset < bytes.length - 2) {
      if (bytes[offset++] !== 255) throw invalidFile();
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 218) { if (!found || offset + 2 > bytes.length || bytes.readUInt16BE(offset) < 2 || offset + bytes.readUInt16BE(offset) > bytes.length - 2) throw invalidFile(); return; }
      if (marker === 217) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) throw invalidFile();
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) throw invalidFile();
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (length < 8) throw invalidFile();
        dimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)); found = true;
      }
      offset += length;
    }
    throw invalidFile();
  }
  if (bytes.length < 30 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP" || bytes.readUInt32LE(4) + 8 !== bytes.length) throw invalidFile();
  let offset = 12, image = false;
  while (offset + 8 <= bytes.length) {
    const kind = bytes.toString("ascii", offset, offset + 4), length = bytes.readUInt32LE(offset + 4), data = offset + 8;
    if (length > bytes.length - data) throw invalidFile();
    if (kind === "VP8X") { if (length !== 10) throw invalidFile(); dimensions(1 + bytes.readUIntLE(data + 4, 3), 1 + bytes.readUIntLE(data + 7, 3)); }
    if (kind === "VP8 ") { if (length < 10 || bytes[data + 3] !== 157 || bytes[data + 4] !== 1 || bytes[data + 5] !== 42) throw invalidFile(); dimensions(bytes.readUInt16LE(data + 6) & 16383, bytes.readUInt16LE(data + 8) & 16383); image = true; }
    if (kind === "VP8L") { if (length < 5 || bytes[data] !== 47) throw invalidFile(); dimensions(1 + bytes[data + 1] + ((bytes[data + 2] & 63) << 8), 1 + (bytes[data + 2] >> 6) + (bytes[data + 3] << 2) + ((bytes[data + 4] & 15) << 10)); image = true; }
    offset = data + length + (length & 1);
  }
  if (!image || offset !== bytes.length) throw invalidFile();
}
function validateDocx(bytes: Buffer) {
  // Read bounded ZIP central-directory records, rejecting encrypted/ZIP64,
  // traversal, macro and embedded executable packages before accepting DOCX.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw invalidFile();
  const count = bytes.readUInt16LE(end + 10), centralSize = bytes.readUInt32LE(end + 12), centralStart = bytes.readUInt32LE(end + 16);
  if (!count || count > 2000 || bytes.readUInt16LE(end + 8) !== count || centralStart + centralSize !== end) throw invalidFile();
  const entries = new Map<string, Buffer>(); let offset = centralStart, expanded = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) throw invalidFile();
    const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10), compressed = bytes.readUInt32LE(offset + 20), size = bytes.readUInt32LE(offset + 24), nameLength = bytes.readUInt16LE(offset + 28), extraLength = bytes.readUInt16LE(offset + 30), commentLength = bytes.readUInt16LE(offset + 32), local = bytes.readUInt32LE(offset + 42);
    if ((flags & 1) || ![0, 8].includes(method) || !nameLength || offset + 46 + nameLength + extraLength + commentLength > end || size > 16 * 1024 * 1024 || (expanded += size) > 60 * 1024 * 1024) throw invalidFile();
    const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (entries.has(name) || /[\\\u0000-\u001f]/.test(name) || name.startsWith("/") || name.split("/").includes("..") || /(?:vba|activex|embeddings)/i.test(name) || (!name.endsWith("/") && !/\.(?:xml|rels|png|jpe?g|gif|webp|emf|wmf|ttf|odttf)$/i.test(name))) throw invalidFile();
    if (local + 30 > centralStart || bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method) throw invalidFile();
    const localNameLength = bytes.readUInt16LE(local + 26), start = local + 30 + localNameLength + bytes.readUInt16LE(local + 28);
    if (start + compressed > centralStart || !bytes.subarray(local + 30, local + 30 + localNameLength).equals(bytes.subarray(offset + 46, offset + 46 + nameLength))) throw invalidFile();
    let content: Buffer = Buffer.alloc(0);
    if (["[Content_Types].xml", "word/document.xml", "_rels/.rels"].includes(name)) {
      const limit = name === "word/document.xml" ? 16 * 1024 * 1024 : 1024 * 1024;
      if (size > limit) throw invalidFile();
      content = method === 0 ? bytes.subarray(start, start + compressed) : inflateRawSync(bytes.subarray(start, start + compressed), { maxOutputLength: limit });
      if (content.length !== size) throw invalidFile();
    }
    entries.set(name, content); offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== end || !entries.has("_rels/.rels")) throw invalidFile();
  const types = entries.get("[Content_Types].xml")?.toString("utf8") || "", document = entries.get("word/document.xml")?.toString("utf8") || "";
  if (!types.includes("application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml") || /macroenabled|vbaproject|<!DOCTYPE|<!ENTITY/i.test(types + document) || !/<(?:[\w]+:)?document(?:\s|>)/.test(document)) throw invalidFile();
}
function validateFile(bytes: Buffer, name: string, declaredMime: string) {
  const extension = name.split(".").pop()?.toLowerCase() || "", mime = MIME_BY_EXTENSION[extension];
  if (!mime || (declaredMime && declaredMime !== "application/octet-stream" && declaredMime !== mime && !(extension === "md" && declaredMime === "text/plain"))) throw invalidFile();
  if (mime.startsWith("image/")) rasterDimensions(bytes, mime);
  else if (extension === "pdf") {
    if (!/^%PDF-[12]\.\d/.test(bytes.toString("ascii", 0, 8)) || !/%%EOF\s*$/.test(bytes.subarray(Math.max(0, bytes.length - 1024)).toString("ascii"))) throw invalidFile();
  } else if (extension === "docx") validateDocx(bytes);
  else {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) || /^\s*(?:<!doctype\s+html|<(?:html|svg|script)\b|#!)/i.test(text)) throw invalidFile();
  }
  return mime;
}
function filename(input: string) {
  const name = input.normalize("NFKC").replace(/[\\/]/g, "_").replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_").trim().replace(/^[. ]+|[. ]+$/g, "");
  if (!name || name.length > 180 || !/\.[a-z0-9]+$/i.test(name)) throw invalidFile();
  return name;
}
async function readMultipart(request: Request) {
  const length = request.headers.get("Content-Length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_FORM_BYTES)) throw new ApiError(413, "knowledge_file_too_large", "Súbor môže mať najviac 15 MB.");
  if (!request.body) throw invalidFile();
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_FORM_BYTES) { await reader.cancel(); throw new ApiError(413, "knowledge_file_too_large", "Súbor môže mať najviac 15 MB."); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  try {
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return await new Response(bytes, { headers: { "Content-Type": request.headers.get("Content-Type") || "" } }).formData();
  } catch { throw invalidFile(); }
}
async function uploadFile(request: Request, env: AuthEnv, session: AccountSession) {
  const form = await readMultipart(request), fields = [...form.keys()], upload = form.get("file");
  if (fields.length !== 1 || fields[0] !== "file" || !upload || typeof upload === "string") throw invalidFile();
  if (!upload.size || upload.size > MAX_FILE_BYTES) throw new ApiError(413, "knowledge_file_too_large", "Súbor musí mať 1 bajt až 15 MB.");
  const name = filename(upload.name), bytes = Buffer.from(await upload.arrayBuffer());
  let mime: string;
  try { mime = validateFile(bytes, name, upload.type); } catch { throw invalidFile(); }
  const id = randomUUID(), key = "knowledge/" + session.accountId + "/files/" + id, createdAt = Date.now();
  const stored = await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: mime } });
  if (!stored) throw unavailable();
  try {
    const result = await env.DB.prepare("INSERT INTO knowledge_files(id,account_id,name,object_key,mime,byte_length,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM wizard_accounts WHERE id=? AND owner_id=?) AND (SELECT count(*) FROM knowledge_files WHERE account_id=?)<5000")
      .bind(id, session.accountId, name, key, mime, bytes.length, createdAt, session.accountId, session.ownerId, session.accountId).run();
    if (result.meta.changes !== 1) throw new ApiError(409, "knowledge_file_limit", "Znalostná mapa môže uchovať najviac 5 000 súborov.");
  } catch (error) { await deleteUnreferenced(env, key, "knowledge_files"); throw error; }
  return json({ file: { id, name, mime, size: bytes.length, url: "/api/knowledge/files/" + id, createdAt } }, 201);
}
export async function handleKnowledgeRequest(request: Request, env: AuthEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname, collection = path === "/api/knowledge", files = path === "/api/knowledge/files", download = new RegExp("^/api/knowledge/files/(" + UUID + ")$").exec(path);
  if (!collection && !files && !download) return null;
  try {
    const session = await requireAccount(request, env);
    if (collection && request.method === "GET") return json(await loadMap(env, session));
    if (collection && request.method === "PUT") { guardWrite(request); verifyCsrf(request, session); return await putMap(request, env, session); }
    if (files && request.method === "POST") {
      if (!/^multipart\/form-data\s*;/i.test(request.headers.get("Content-Type") || "")) throw new ApiError(415, "multipart_required", "Súbor odošli ako prílohu formulára.");
      // Reuse the existing origin/request guard, with the multipart type checked
      // above; the original request body stays untouched for bounded reading.
      const headers = new Headers(request.headers); headers.set("Content-Type", "application/json");
      guardWrite(new Request(request.url, { method: "POST", headers })); verifyCsrf(request, session);
      return await uploadFile(request, env, session);
    }
    if (download && request.method === "GET") {
      const row = await file(env, session, download[1]), object = await env.BUCKET.get(row.object_key);
      if (!object || object.size !== row.byte_length || object.size > MAX_FILE_BYTES) throw unavailable();
      const raster = /^image\/(?:png|jpeg|webp)$/.test(row.mime);
      return new Response(object.body, { headers: { "Content-Type": raster ? row.mime : "application/octet-stream", "Content-Length": String(object.size), "Content-Disposition": (raster ? "inline" : "attachment") + "; filename=\"download." + (row.name.split(".").pop() || "bin") + "\"; filename*=UTF-8''" + encodeURIComponent(row.name).replace(/['()*]/g, char => "%" + char.charCodeAt(0).toString(16).toUpperCase()), "Cache-Control": "no-store, private", "Pragma": "no-cache", "Vary": "Cookie", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" } });
    }
    throw new ApiError(405, "method_not_allowed", "Táto operácia nie je podporovaná.");
  } catch (error) {
    const api = error instanceof ApiError ? error : unavailable();
    return json({ error: { code: api.code, message: api.message } }, api.status);
  }
}
