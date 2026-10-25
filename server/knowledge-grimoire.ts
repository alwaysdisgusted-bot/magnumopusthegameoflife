import { createHash, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import GrimoireModel from "./knowledge-grimoire-model.mjs";
import GameModel from "./game-model.mjs";
import KnowledgeCatalog from "./knowledge-catalog.mjs";
import { ApiError, guardWrite, json, loadSave, readJson, requireAccount, verifyCsrf } from "./auth";
import type { AccountSession, AuthEnv } from "./auth";

const MAX_STATE_BYTES = 100 * 1024 * 1024;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_FORM_BYTES = MAX_FILE_BYTES + 64 * 1024;
const MAX_FILES = 10000;
const ID = /^[a-zA-Z0-9_-]{1,160}$/;
const ALLOWED_EXTENSIONS = new Set([
  ".doc", ".docx", ".docm", ".dot", ".dotx", ".dotm",
  ".pdf", ".ppt", ".pptx", ".pps", ".ppsx", ".pptm", ".ppsm", ".pot", ".potx", ".potm",
  ".xlsx", ".xlsm", ".odt", ".ods", ".odp", ".rtf", ".html", ".htm",
  ".csv", ".tsv", ".json", ".xml", ".log", ".txt", ".md", ".markdown",
]);
const encoder = new TextEncoder();
interface Pointer {
  revision: number;
  object_key: string;
  updated_at: number;
}
interface FileRow {
  id: string;
  account_id: string;
  name: string;
  media_type: string;
  byte_length: number;
  sha256: string;
  object_key: string;
  created_at: number;
}
interface GrimoireFileReferenceState {
  documents: Array<{ id: string; fileId: string; size: number; mapDocumentId?: string }>;
}
interface TermDetails {
  fieldId: string; categoryId: string; term: string; description: string; note: string;
  documentIds: string[]; folderIds: string[]; collectionIds: string[];
  parent?: { termId: string } | { term: string } | null;
}
interface TermRow {
  id: string; account_id: string; revision: number; details: string; creation_key: string; created_at: number;
}

async function readingProgress(env: AuthEnv, session: AccountSession) {
  const row = await env.DB.prepare("SELECT turns FROM knowledge_reading_progress WHERE account_id=?")
    .bind(session.accountId).first<{ turns: number }>();
  const turns = row?.turns ?? 0;
  return { turns, towardsReward: turns % 25 };
}

async function recordReadingTurn(request: Request, env: AuthEnv, session: AccountSession) {
  const body = await readJson(request, 4096);
  if (Object.keys(body).sort().join("|") !== ["eventId","documentId","fromPage","toPage","expectedGameRevision"].sort().join("|") ||
    typeof body.eventId !== "string" || !/^[a-f0-9-]{36}$/.test(body.eventId) ||
    typeof body.documentId !== "string" || !ID.test(body.documentId) ||
    !Number.isSafeInteger(body.fromPage) || !Number.isSafeInteger(body.toPage) ||
    (body.fromPage as number) < 1 || (body.toPage as number) < 1 ||
    (body.fromPage as number) > 1000000 || (body.toPage as number) > 1000000 ||
    Math.abs((body.toPage as number) - (body.fromPage as number)) !== 1) {
    throw new ApiError(422, "invalid_reading_turn", "Započítať možno iba skutočné otočenie na susednú stranu.");
  }
  const payload = JSON.stringify({ documentId: body.documentId, fromPage: body.fromPage, toPage: body.toPage });
  const existing = () => env.DB.prepare("SELECT payload,ledger_entry FROM knowledge_reading_turns WHERE account_id=? AND event_id=?")
    .bind(session.accountId, body.eventId).first<{ payload: string; ledger_entry: string | null }>();
  const responseForRetry = async (row: { payload: string; ledger_entry: string | null }) => {
    if (row.payload !== payload) throw new ApiError(409, "reading_event_conflict", "Toto otočenie už má iné potvrdené údaje.");
    return json({ ...await readingProgress(env, session), awarded: false,
      ...(row.ledger_entry ? { save: await loadSave(env, session.accountId, session.ownerId) } : {}) });
  };
  const previousEvent = await existing();
  if (previousEvent) return responseForRetry(previousEvent);
  const snapshot = await loadState(env, session);
  if (!snapshot.state.documents.some(document => document.id === body.documentId)) {
    throw new ApiError(404, "reading_document_unavailable", "Dokument nepatrí aktuálnemu Grimoáru.");
  }
  await env.DB.prepare("INSERT INTO knowledge_reading_progress(account_id,turns) VALUES(?,0) ON CONFLICT(account_id) DO NOTHING")
    .bind(session.accountId).run();
  const progress = await readingProgress(env, session);
  if (!Number.isSafeInteger(progress.turns + 1)) throw unavailable();
  const awarded = (progress.turns + 1) % 25 === 0;
  const saved = awarded ? await loadSave(env, session.accountId, session.ownerId) : null;
  if (saved && body.expectedGameRevision !== saved.revision) {
    throw new ApiError(409, "save_conflict", "Progres sa zmenil. Otočenie zatiaľ nebolo započítané; zachovaj koncept a zopakuj potvrdenie.");
  }
  const now = Date.now(), at = new Date(now).toISOString();
  const entry = { id: "reading-" + body.eventId, type: "grimoire-reading", label: "Grimoár: 25 otočení strán",
    coins: 1, powder: 0, amount: 25, metric: "", ref: body.eventId, at, dateKey: GameModel.dateKey(at) };
  const state = saved ? GameModel.validateState({ ...saved.state, ledger: [...saved.state.ledger, entry] }) : null;
  const objectKey = state ? `saves/${session.accountId}/${randomUUID()}.json` : null;
  if (objectKey && !await env.BUCKET.put(objectKey, JSON.stringify(state), { httpMetadata: { contentType: "application/json" } })) throw unavailable();
  try {
    // The event's NOT NULL account gates the complete transaction on progress,
    // source and (when crediting) game revisions. Retries keep the same event ID.
    const statements = [
      env.DB.prepare("INSERT INTO knowledge_reading_turns(event_id,account_id,payload,ledger_entry) VALUES(?,(SELECT p.account_id FROM knowledge_reading_progress p JOIN wizard_accounts a ON a.id=p.account_id WHERE p.account_id=? AND a.owner_id=? AND p.turns=? AND COALESCE((SELECT g.revision FROM knowledge_grimoire_states g WHERE g.account_id=p.account_id),0)=? AND (?=0 OR EXISTS(SELECT 1 FROM wizard_saves s WHERE s.account_id=p.account_id AND s.revision=?))),?,?)")
        .bind(body.eventId, session.accountId, session.ownerId, progress.turns, snapshot.revision, awarded ? 1 : 0, saved?.revision ?? 0, payload, awarded ? JSON.stringify(entry) : null),
      env.DB.prepare("UPDATE knowledge_reading_progress SET turns=turns+1 WHERE account_id=?").bind(session.accountId),
    ];
    if (saved && objectKey) statements.push(env.DB.prepare("UPDATE wizard_saves SET revision=revision+1,object_key=?,updated_at=? WHERE account_id=?")
      .bind(objectKey, now, session.accountId));
    await env.DB.batch(statements);
  } catch (error) {
    if (objectKey) {
      const live = await env.DB.prepare("SELECT object_key FROM wizard_saves WHERE account_id=?").bind(session.accountId).first<{ object_key: string }>();
      if (live && live.object_key !== objectKey) await env.BUCKET.delete(objectKey);
    }
    const committed = await existing();
    if (committed) return responseForRetry(committed);
    console.error("grimoire_reading_commit_failed", error instanceof Error ? error.name : "unknown");
    throw new ApiError(409, "reading_conflict", "Otočenie sa nepotvrdilo. Počítadlo alebo progres sa zmenili; zopakuj potvrdenie.");
  }
  return json({ turns: progress.turns + 1, towardsReward: (progress.turns + 1) % 25, awarded,
    ...(saved ? { save: { state, revision: saved.revision + 1, updatedAt: now } } : {}) });
}

function termInput(raw: unknown): TermDetails {
  const invalid = () => new ApiError(422, "invalid_terminology", "Vyplň platný termín, vetvu, poznámku a dostupné zdroje.");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid();
  const row = raw as Record<string, unknown>;
  if (Object.keys(row).filter(key => key !== "parent").sort().join("|") !==
    ["fieldId", "categoryId", "term", "description", "note", "documentIds", "folderIds", "collectionIds"].sort().join("|")) throw invalid();
  for (const [key, max] of [["fieldId",160], ["categoryId",160], ["term",150], ["description",2000], ["note",500]] as const) {
    if (typeof row[key] !== "string" || row[key].length > max ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(row[key])) throw invalid();
  }
  const field = KnowledgeCatalog.fields.find((item: { id: string }) => item.id === row.fieldId);
  const category = field?.categories.find((item: { id: string }) => item.id === row.categoryId);
  if (!category || !(row.term as string).trim() ||
    category.terms.some((item: string) => normalizeTerm(item) === normalizeTerm(row.term as string))) throw invalid();
  const ids = (key: string) => {
    const values = row[key];
    if (!Array.isArray(values) || values.length > MAX_FILES ||
      values.some(value => typeof value !== "string" || !ID.test(value))) throw invalid();
    return [...new Set(values)] as string[];
  };
  const parent = row.parent;
  if (parent !== undefined && parent !== null && (typeof parent !== "object" || Array.isArray(parent) ||
    !(Object.keys(parent).join("|") === "termId" && "termId" in parent && typeof parent.termId === "string" && ID.test(parent.termId)) &&
    !(Object.keys(parent).join("|") === "term" && "term" in parent && typeof parent.term === "string" && category.terms.includes(parent.term)))) throw invalid();
  return { fieldId: row.fieldId as string, categoryId: row.categoryId as string,
    term: (row.term as string).trim(), description: (row.description as string).trim(), note: row.note as string,
    documentIds: ids("documentIds"), folderIds: ids("folderIds"), collectionIds: ids("collectionIds"),
    ...(parent !== undefined ? {parent: parent as TermDetails["parent"]} : {}) };
}

function termPath(term: TermDetails & {id: string}, terms: Array<TermDetails & {id: string}>) {
  const field = KnowledgeCatalog.fields.find((item: {id: string}) => item.id === term.fieldId);
  const category = field?.categories.find((item: {id: string}) => item.id === term.categoryId);
  if (!field || !category) throw new ApiError(422,"term_branch","Vetva terminológie nie je dostupná.");
  const path: Array<{key: string; title: string}> = [];
  const seen = new Set<string>();
  let current = term;
  while (true) {
    if (seen.has(current.id) || path.length >= 100) throw new ApiError(422, "term_cycle", "Vetva obsahuje cyklus alebo viac než 100 úrovní.");
    seen.add(current.id);
    path.unshift({key:current.id,title:current.term});
    if (!current.parent) break;
    if ("term" in current.parent) {
      path.unshift({key:`builtin_${field.id}_${category.id}_${category.terms.indexOf(current.parent.term)}`,title:current.parent.term});
      break;
    }
    const parentId = current.parent.termId;
    const parent = terms.find(item => item.id === parentId);
    if (!parent || parent.fieldId !== term.fieldId || parent.categoryId !== term.categoryId) {
      throw new ApiError(422, "term_parent", "Nadradená bublina nie je dostupná v tejto vetve a účte.");
    }
    current = parent;
  }
  return [{key:`field_${field.id}`,title:field.name},{key:`category_${field.id}_${category.id}`,title:category.name},...path];
}

function normalizeTerm(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("sk").trim().replace(/\s+/g, " ");
}

async function terminologyRows(env: AuthEnv, session: AccountSession) {
  return (await env.DB.prepare("SELECT t.* FROM knowledge_terminology t JOIN wizard_accounts a ON a.id=t.account_id WHERE t.account_id=? AND a.owner_id=? ORDER BY t.created_at,t.id")
    .bind(session.accountId, session.ownerId).all<TermRow>()).results;
}

async function terminologyCatalog(env: AuthEnv, session: AccountSession) {
  const snapshot = await loadState(env, session);
  const state = GrimoireModel.validateState(snapshot.state);
  const receipts = (await env.DB.prepare("SELECT term_id FROM knowledge_term_rewards WHERE account_id=?")
    .bind(session.accountId).all<{ term_id: string }>()).results;
  const terms = (await terminologyRows(env, session)).map(row => {
    const details = termInput(JSON.parse(row.details));
    const sources = GrimoireModel.terminologySources(state, details, false);
    return { id: row.id, revision: row.revision, ...details, sourceIds: sources,
      rewarded: receipts.some(receipt => receipt.term_id === row.id) };
  });
  return { terms: terms.map(term => ({...term,folderPath:termPath(term,terms)})), favoriteWords: state.favoriteWords, collections: state.wordCollections.map((item: { id: string; favoriteId: string }) =>
    ({ ...item, word: state.favoriteWords.find((favorite: { id: string }) => favorite.id === item.favoriteId)?.word,
      sourceIds: GrimoireModel.collectionSourceIds(state, item.id) })),
  folders: state.folders, tabs: state.tabs, documents: state.documents };
}

async function mutateTerminology(request: Request, env: AuthEnv, session: AccountSession) {
  const body = await readJson(request, 1024 * 1024);
  const operation = body.operation;
  if (operation !== "create" && operation !== "save") throw new ApiError(422, "invalid_terminology_operation", "Neplatná zmena terminológie.");
  const details = termInput(body.details);
  const rows = await terminologyRows(env, session);
  if (rows.length >= MAX_FILES && operation === "create") throw new ApiError(409, "term_limit", "Strom dosiahol limit vlastných termínov.");
  const key = body.creationKey;
  if (operation === "create" && (typeof key !== "string" || !/^[a-f0-9-]{36}$/.test(key))) {
    throw new ApiError(422, "invalid_term_key", "Chýba identita vytváraného termínu.");
  }
  const previous = operation === "create" ? rows.find(row => row.creation_key === key) : rows.find(row => row.id === body.id);
  if (operation === "create" && previous) return json({ catalog: await terminologyCatalog(env, session), termId: previous.id, awarded: false });
  if (operation === "save" && !previous) throw new ApiError(404, "term_not_found", "Tento vlastný termín nepatrí aktuálnemu účtu.");
  if (previous && body.expectedRevision !== previous.revision) throw conflict();
  const pathTerms = rows.map(row => ({id:row.id,...termInput(JSON.parse(row.details))}));
  const proposedId = previous?.id ?? "pending";
  termPath({id:proposedId,...details}, [...pathTerms.filter(row => row.id !== proposedId),{id:proposedId,...details}]);
  if (previous && JSON.stringify(termInput(JSON.parse(previous.details)).parent ?? null) !== JSON.stringify(details.parent ?? null)) {
    throw new ApiError(422,"term_parent_immutable","Nadradenú bublinu existujúceho termínu touto úpravou nemeníme.");
  }
  if (previous && pathTerms.some(row => row.parent && "termId" in row.parent && row.parent.termId === previous.id) &&
    (JSON.parse(previous.details).fieldId !== details.fieldId || JSON.parse(previous.details).categoryId !== details.categoryId)) {
    throw new ApiError(422,"term_children","Vetvu s podbublinami nemožno presunúť samostatne.");
  }
  if (rows.some(row => {
    const value = JSON.parse(row.details) as TermDetails;
    return row.id !== previous?.id && value.fieldId === details.fieldId && value.categoryId === details.categoryId &&
      normalizeTerm(value.term) === normalizeTerm(details.term);
  })) throw new ApiError(409, "term_duplicate", "V tejto vetve už máš rovnaký vlastný termín.");
  const snapshot = await loadState(env, session);
  let sources: string[];
  try { sources = GrimoireModel.terminologySources(snapshot.state, details, true); }
  catch (error) { throw new ApiError(422, "term_source_unavailable",
    error instanceof Error ? error.message : "Zdroj termínu nie je dostupný."); }
  const id = previous?.id ?? "term_" + randomUUID(), now = Date.now();
  if (!previous) {
    // Creation never awards; only a subsequently saved, server-registered term is eligible.
    if (details.documentIds.length || details.folderIds.length || details.collectionIds.length) {
      throw new ApiError(422, "term_create_sources", "Najprv vytvor termín, potom k nemu pripoj zdroje.");
    }
    try {
      await env.DB.prepare("INSERT INTO knowledge_terminology(id,account_id,creation_key,revision,details,created_at) VALUES(?,?,?,1,?,?)")
        .bind(id, session.accountId, key, JSON.stringify(details), now).run();
    } catch (error) {
      const retry = (await terminologyRows(env, session)).find(row => row.creation_key === key);
      if (!retry) throw error;
      return json({ catalog: await terminologyCatalog(env, session), termId: retry.id, awarded: false });
    }
    return json({ catalog: await terminologyCatalog(env, session), termId: id, awarded: false }, 201);
  }
  const receipt = await env.DB.prepare("SELECT term_id FROM knowledge_term_rewards WHERE term_id=? AND account_id=?")
    .bind(id, session.accountId).first();
  if (sources.length < 3 || receipt) {
    const result = await env.DB.prepare("UPDATE knowledge_terminology SET details=?,revision=revision+1 WHERE id=? AND account_id=? AND revision=?")
      .bind(JSON.stringify(details), id, session.accountId, previous.revision).run();
    if (result.meta.changes !== 1) throw conflict();
    return json({ catalog: await terminologyCatalog(env, session), termId: id, awarded: false });
  }
  const saved = await loadSave(env, session.accountId, session.ownerId);
  if (body.expectedGameRevision !== saved.revision) {
    throw new ApiError(409, "save_conflict", "Herný progres sa zmenil. Odmena sa nepripísala; zachovaj koncept a načítaj uloženú hru.");
  }
  const at = new Date(now).toISOString();
  const entry = { id: "reward-" + id, type: "knowledge-term", label: `Nová terminológia: ${details.term}`,
    coins: 10, powder: 0, amount: 1, metric: "", ref: id, at, dateKey: GameModel.dateKey(at) };
  const state = GameModel.validateState({ ...saved.state, ledger: [...saved.state.ledger, entry] });
  const objectKey = `saves/${session.accountId}/${randomUUID()}.json`;
  if (!await env.BUCKET.put(objectKey, JSON.stringify(state), { httpMetadata: { contentType: "application/json" } })) throw unavailable();
  try {
    // NOT NULL gates the whole D1 transaction on all three revisions; a stale
    // source snapshot, concurrent award or game save rolls every statement back.
    await env.DB.batch([
      env.DB.prepare("INSERT INTO knowledge_term_rewards(term_id,account_id,ledger_entry,created_at) VALUES(?,(SELECT s.account_id FROM wizard_saves s JOIN wizard_accounts a ON a.id=s.account_id WHERE s.account_id=? AND a.owner_id=? AND s.revision=? AND EXISTS(SELECT 1 FROM knowledge_terminology t WHERE t.id=? AND t.account_id=s.account_id AND t.revision=?) AND COALESCE((SELECT g.revision FROM knowledge_grimoire_states g WHERE g.account_id=s.account_id),0)=?),?,?)")
        .bind(id, session.accountId, session.ownerId, saved.revision, id, previous.revision, snapshot.revision, JSON.stringify(entry), now),
      env.DB.prepare("UPDATE knowledge_terminology SET details=?,revision=revision+1 WHERE id=? AND account_id=?")
        .bind(JSON.stringify(details), id, session.accountId),
      env.DB.prepare("UPDATE wizard_saves SET revision=revision+1,object_key=?,updated_at=? WHERE account_id=?")
        .bind(objectKey, now, session.accountId),
    ]);
  } catch {
    const committed = await env.DB.prepare("SELECT term_id FROM knowledge_term_rewards WHERE term_id=? AND account_id=?")
      .bind(id, session.accountId).first();
    const live = await env.DB.prepare("SELECT object_key FROM wizard_saves WHERE account_id=?").bind(session.accountId).first<{ object_key: string }>();
    if (live && live.object_key !== objectKey) await env.BUCKET.delete(objectKey);
    if (!committed) throw new ApiError(409, "term_reward_conflict", "Zdroje alebo progres sa zmenili. Odmena sa nepotvrdila; obnov katalóg a skús znova.");
    const current = (await terminologyRows(env, session)).find(row => row.id === id);
    if (!current || JSON.stringify(termInput(JSON.parse(current.details))) !== JSON.stringify(details)) {
      throw new ApiError(409, "term_reward_conflict", "Termín uložilo iné okno s inými zdrojmi. Tvoj koncept zostal zachovaný; obnov katalóg.");
    }
    return json({ catalog: await terminologyCatalog(env, session), termId: id, awarded: false,
      save: await loadSave(env, session.accountId, session.ownerId) });
  }
  return json({ catalog: await terminologyCatalog(env, session), termId: id, awarded: true,
    save: { state, revision: saved.revision + 1, updatedAt: now } });
}

function unavailable() {
  return new ApiError(503, "grimoire_unavailable", "Grimoár sa momentálne nedá načítať alebo uložiť. Rozpracované zmeny zostali zachované.");
}
function conflict() {
  return new ApiError(409, "grimoire_conflict", "Grimoár sa zmenil v inom okne. Načítaj uloženú verziu a skús to znova.");
}
function invalidFile() {
  return new ApiError(422, "invalid_grimoire_file", "Vyber podporovaný dokument do 50 MB. Pôvodný súbor nebol uložený.");
}

async function pointer(env: AuthEnv, session: AccountSession) {
  return env.DB.prepare(
    "SELECT g.revision,g.object_key,g.updated_at " +
    "FROM knowledge_grimoire_states g JOIN wizard_accounts a ON a.id=g.account_id " +
    "WHERE g.account_id=? AND a.owner_id=?",
  ).bind(session.accountId, session.ownerId).first<Pointer>();
}

async function getFile(env: AuthEnv, session: AccountSession, id: string) {
  const row = await env.DB.prepare(
    "SELECT f.id,f.account_id,f.name,f.media_type,f.byte_length,f.sha256,f.object_key,f.created_at " +
    "FROM knowledge_grimoire_files f JOIN wizard_accounts a ON a.id=f.account_id " +
    "WHERE f.id=? AND f.account_id=? AND a.owner_id=?",
  ).bind(id, session.accountId, session.ownerId).first<FileRow>();
  if (!row) throw new ApiError(404, "grimoire_file_not_found", "Tento súkromný dokument nie je dostupný.");
  return row;
}

async function deleteUnreferenced(env: AuthEnv, key: string, table: "knowledge_grimoire_states" | "knowledge_grimoire_files") {
  try {
    const reference = await env.DB.prepare(`SELECT ${table === "knowledge_grimoire_states" ? "account_id" : "id"} FROM ${table} WHERE object_key=?`)
      .bind(key).first();
    if (!reference) await env.BUCKET.delete(key);
  } catch { /* Retain an object rather than risk deleting a committed file. */ }
}

async function loadState(env: AuthEnv, session: AccountSession): Promise<{
  state: GrimoireFileReferenceState;
  revision: number;
  updatedAt: number | null;
}> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const row = await pointer(env, session);
    if (!row) return { state: GrimoireModel.createState(), revision: 0, updatedAt: null };
    const object = await env.BUCKET.get(row.object_key);
    if (!object) continue;
    if (object.size > MAX_STATE_BYTES) throw unavailable();
    try {
      const state = GrimoireModel.validateState(JSON.parse(await object.text()));
      await verifyFiles(state, env, session);
      return {
        state,
        revision: row.revision,
        updatedAt: row.updated_at,
      };
    } catch { throw unavailable(); }
  }
  throw unavailable();
}

async function verifyFiles(state: GrimoireFileReferenceState, env: AuthEnv, session: AccountSession) {
  const ids = [...new Set(state.documents.filter(document => document.mapDocumentId === undefined).map(document => document.fileId))];
  for (let start = 0; start < ids.length; start += 80) {
    const chunk = ids.slice(start, start + 80);
    const rows = await env.DB.prepare(
      "SELECT f.id,f.byte_length FROM knowledge_grimoire_files f JOIN wizard_accounts a ON a.id=f.account_id " +
      `WHERE f.account_id=? AND a.owner_id=? AND f.id IN (${chunk.map(() => "?").join(",")})`,
    ).bind(session.accountId, session.ownerId, ...chunk).all<{ id: string; byte_length: number }>();
    if (rows.results.length !== chunk.length) throw new ApiError(422, "invalid_grimoire_file", "Grimoár odkazuje na nedostupný originálny súbor.");
    const sizes = new Map(rows.results.map(row => [row.id, row.byte_length]));
    for (const document of state.documents) {
      if (chunk.includes(document.fileId) && sizes.get(document.fileId) !== document.size) {
        throw new ApiError(422, "invalid_grimoire_file", "Veľkosť originálneho súboru nesúhlasí s Grimoárom.");
      }
    }
  }
}

async function putState(
  request: Request,
  env: AuthEnv,
  session: AccountSession,
) {
  const body = await readJson(request, MAX_STATE_BYTES + 1024);
  const expectedRevision = body.expectedRevision;
  if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0 ||
    (expectedRevision as number) >= Number.MAX_SAFE_INTEGER) {
    throw new ApiError(422, "invalid_revision", "Chýba platná revízia Grimoára.");
  }
  let state: GrimoireFileReferenceState;
  try { state = GrimoireModel.validateState(body.state); }
  catch { throw new ApiError(422, "invalid_grimoire", "Údaje Grimoára nie sú platné. Uložená verzia zostala zachovaná."); }
  const contents = JSON.stringify(state);
  if (encoder.encode(contents).byteLength > MAX_STATE_BYTES) {
    throw new ApiError(413, "grimoire_too_large", "Uložené texty Grimoára presahujú 100 MB.");
  }

  const previous = await pointer(env, session);
  if ((previous?.revision ?? 0) !== expectedRevision) throw conflict();

  await verifyFiles(state, env, session);
  const serialized = JSON.stringify(state);

  const objectKey = `knowledge/${session.accountId}/grimoire/${randomUUID()}.json`;
  const updatedAt = Date.now();
  const stored = await env.BUCKET.put(objectKey, serialized, { httpMetadata: { contentType: "application/json" } });
  if (!stored) throw unavailable();
  try {
    const result = expectedRevision === 0
      ? await env.DB.prepare(
        "INSERT INTO knowledge_grimoire_states(account_id,revision,object_key,updated_at,imported_source_hash,imported_at) " +
        "SELECT ?,1,?,?,NULL,NULL WHERE EXISTS(SELECT 1 FROM wizard_accounts WHERE id=? AND owner_id=?) " +
        "ON CONFLICT(account_id) DO NOTHING",
      ).bind(session.accountId, objectKey, updatedAt, session.accountId, session.ownerId).run()
      : await env.DB.prepare(
        "UPDATE knowledge_grimoire_states SET revision=revision+1,object_key=?,updated_at=? " +
        "WHERE account_id=? AND revision=? " +
        "AND EXISTS(SELECT 1 FROM wizard_accounts a WHERE a.id=knowledge_grimoire_states.account_id AND a.owner_id=?)",
      ).bind(objectKey, updatedAt, session.accountId, expectedRevision, session.ownerId).run();
    if (result.meta.changes !== 1) throw conflict();
  } catch (error) {
    await deleteUnreferenced(env, objectKey, "knowledge_grimoire_states");
    throw error;
  }
  if (previous) await deleteUnreferenced(env, previous.object_key, "knowledge_grimoire_states");
  return json({ revision: (expectedRevision as number) + 1, updatedAt });
}

async function readBoundedBody(request: Request) {
  const length = request.headers.get("Content-Length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_FORM_BYTES)) {
    throw new ApiError(413, "grimoire_file_too_large", "Dokument môže mať najviac 50 MB.");
  }
  if (!request.body) throw invalidFile();
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_FORM_BYTES) {
        await reader.cancel();
        throw new ApiError(413, "grimoire_file_too_large", "Dokument môže mať najviac 50 MB.");
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new Request(request.url, { method: "POST", headers: request.headers, body });
}

function fileName(value: string) {
  const name = value.normalize("NFKC").replace(/[\\/]/g, "_").replace(/[\u0000-\u001f\u007f]/g, "_").trim();
  const extension = name.match(/\.[^.]+$/)?.[0].toLowerCase();
  if (!name || name.length > 1024 || !extension || !ALLOWED_EXTENSIONS.has(extension)) throw invalidFile();
  return name;
}

async function uploadFile(request: Request, env: AuthEnv, session: AccountSession) {
  const bounded = await readBoundedBody(request);
  let form: FormData;
  try { form = await bounded.formData(); } catch { throw invalidFile(); }
  const fields = [...form.keys()].sort();
  const upload = form.get("file"), requestedId = form.get("id");
  if (fields.join("|") !== "file|id" || !upload || typeof upload === "string" ||
    typeof requestedId !== "string" || !ID.test(requestedId) || !upload.size || upload.size > MAX_FILE_BYTES) {
    throw invalidFile();
  }
  const name = fileName(upload.name);
  const mediaType = (upload.type || "application/octet-stream").slice(0, 127);
  if (/[\u0000-\u001f\u007f]/.test(mediaType)) throw invalidFile();
  const bytes = Buffer.from(await upload.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const existing = await env.DB.prepare(
    "SELECT id,account_id,name,media_type,byte_length,sha256,object_key,created_at " +
    "FROM knowledge_grimoire_files WHERE id=? AND account_id=?",
  ).bind(requestedId, session.accountId).first<FileRow>();
  if (existing) {
    if (existing.sha256 !== sha256 || existing.byte_length !== bytes.length) {
      throw new ApiError(409, "grimoire_file_conflict", "Tento dokument sa už v lokálnom Grimoári nachádza s iným obsahom.");
    }
    return json({ file: { id: existing.id, name: existing.name, mediaType: existing.media_type, size: existing.byte_length }, unchanged: true });
  }
  const count = await env.DB.prepare("SELECT count(*) AS count FROM knowledge_grimoire_files WHERE account_id=?")
    .bind(session.accountId).first<{ count: number }>();
  if (!count || count.count >= MAX_FILES) throw new ApiError(409, "grimoire_file_limit", "Lokálny Grimoár môže uchovať najviac 10 000 dokumentov.");

  const objectKey = `knowledge/${session.accountId}/grimoire/files/${requestedId}`;
  const stored = await env.BUCKET.put(objectKey, bytes, { httpMetadata: { contentType: "application/octet-stream" } });
  if (!stored) throw unavailable();
  const createdAt = Date.now();
  try {
    const result = await env.DB.prepare(
      "INSERT INTO knowledge_grimoire_files(id,account_id,name,media_type,byte_length,sha256,object_key,created_at) " +
      "SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM wizard_accounts WHERE id=? AND owner_id=?)",
    ).bind(requestedId, session.accountId, name, mediaType, bytes.length, sha256, objectKey, createdAt, session.accountId, session.ownerId).run();
    if (result.meta.changes !== 1) throw new ApiError(409, "grimoire_file_conflict", "Dokument sa zmenil; obnov Grimoár a skús to znova.");
  } catch (error) {
    await deleteUnreferenced(env, objectKey, "knowledge_grimoire_files");
    throw error;
  }
  return json({ file: { id: requestedId, name, mediaType, size: bytes.length } }, 201);
}

async function removeFile(request: Request, env: AuthEnv, session: AccountSession, id: string) {
  const state = await loadState(env, session);
  if (state.state.documents.some(document => document.fileId === id)) {
    throw new ApiError(409, "grimoire_file_in_use", "Dokument je stále uložený v Grimoári.");
  }
  const row = await getFile(env, session, id);
  const result = await env.DB.prepare("DELETE FROM knowledge_grimoire_files WHERE id=? AND account_id=? AND object_key=?")
    .bind(id, session.accountId, row.object_key).run();
  if (result.meta.changes !== 1) throw new ApiError(409, "grimoire_file_conflict", "Dokument sa medzitým zmenil.");
  try { await env.BUCKET.delete(row.object_key); }
  catch { throw unavailable(); }
  return json({ ok: true });
}

export async function handleKnowledgeGrimoireRequest(request: Request, env: AuthEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const collection = path === "/api/knowledge/grimoire";
  const search = path === "/api/knowledge/grimoire/search";
  const terminology = path === "/api/knowledge/grimoire/terminology";
  const reading = path === "/api/knowledge/grimoire/reading";
  const files = path === "/api/knowledge/grimoire/files";
  const file = /^\/api\/knowledge\/grimoire\/files\/([A-Za-z0-9_-]{1,160})$/.exec(path);
  if (!collection && !search && !files && !file && !terminology && !reading) return null;
  try {
    const session = await requireAccount(request, env);
    if (reading && request.method === "GET") return json(await readingProgress(env, session));
    if (reading && request.method === "POST") {
      guardWrite(request); verifyCsrf(request, session);
      return await recordReadingTurn(request, env, session);
    }
    if (terminology && request.method === "GET") return json(await terminologyCatalog(env, session));
    if (terminology && request.method === "POST") {
      guardWrite(request); verifyCsrf(request, session);
      return await mutateTerminology(request, env, session);
    }
    if (collection && request.method === "GET") return json(await loadState(env, session));
    if (search && request.method === "GET") {
      const query = new URL(request.url).searchParams.get("q") ?? "";
      const snapshot = await loadState(env, session);
      return json({ results: GrimoireModel.searchState(snapshot.state, query) });
    }
    if (collection && request.method === "PUT") {
      guardWrite(request); verifyCsrf(request, session);
      return await putState(request, env, session);
    }
    if (files && request.method === "POST") {
      if (!/^multipart\/form-data\s*;/i.test(request.headers.get("Content-Type") || "")) {
        throw new ApiError(415, "multipart_required", "Dokument odošli ako prílohu formulára.");
      }
      const headers = new Headers(request.headers);
      headers.set("Content-Type", "application/json");
      guardWrite(new Request(request.url, { method: "POST", headers }));
      verifyCsrf(request, session);
      return await uploadFile(request, env, session);
    }
    if (file && request.method === "GET") {
      const row = await getFile(env, session, file[1]);
      const object = await env.BUCKET.get(row.object_key);
      if (!object || object.size !== row.byte_length || object.size > MAX_FILE_BYTES) throw unavailable();
      return new Response(object.body, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(object.size),
          "Content-Disposition": `attachment; filename="document.bin"; filename*=UTF-8''${encodeURIComponent(row.name).replace(/['()*]/g, char => "%" + char.charCodeAt(0).toString(16).toUpperCase())}`,
          "Cache-Control": "no-store, private",
          "Pragma": "no-cache",
          "Vary": "Cookie",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
        },
      });
    }
    if (file && request.method === "DELETE") {
      guardWrite(request); verifyCsrf(request, session);
      return await removeFile(request, env, session, file[1]);
    }
    throw new ApiError(405, "method_not_allowed", "Táto operácia nie je podporovaná.");
  } catch (error) {
    if (error instanceof ApiError) {
      return json({ error: { code: error.code, message: error.message } }, error.status);
    }
    return json({ error: { code: "grimoire_unavailable", message: unavailable().message } }, 503);
  }
}
