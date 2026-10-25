const MAX_ITEMS = 10000;
const MAX_TEXT = 20 * 1024 * 1024;
const ID = /^[a-zA-Z0-9_-]{1,160}$/;

function fail(message = "Údaje Grimoára nie sú platné.") {
  throw new Error(message);
}

function plain(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail();
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !keys.includes(key) || !descriptor || !Object.hasOwn(descriptor, "value")) fail();
  }
  return value;
}

function list(value) {
  if (!Array.isArray(value) || value.length > MAX_ITEMS || Reflect.ownKeys(value).length !== value.length + 1) fail();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) fail();
  }
  return value;
}

function text(value, max, required = false) {
  if (typeof value !== "string" || value.length > max ||
    (required && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail();
  return value;
}

function id(value) {
  if (typeof value !== "string" || !ID.test(value) || ["__proto__", "constructor", "prototype"].includes(value)) fail();
  return value;
}

function integer(value, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) fail();
  return value;
}

function unique(items, key = "id") {
  const ids = new Set();
  for (const item of items) {
    const value = item[key];
    if (ids.has(value)) fail();
    ids.add(value);
  }
  return ids;
}

function record(value, keys) {
  return plain(value, keys);
}

export function createState() {
  return {
    version: 1,
    tabs: [],
    folders: [],
    documents: [],
    textSegments: [],
    favoriteWords: [],
    readingPositions: [],
    readingMarkers: [],
    wordCollections: [],
    editedTexts: [],
    mapLinks: [],
  };
}

export function validateState(raw) {
  const state = plain(raw, [
    "version", "tabs", "folders", "documents", "textSegments", "favoriteWords",
    "readingPositions", "readingMarkers", "wordCollections", "editedTexts", "mapLinks",
  ]);
  if (state.version !== 1) fail();

  const tabs = list(state.tabs).map(item => {
    const row = record(item, ["id", "title"]);
    return { id: id(row.id), title: text(row.title, 80, true) };
  });
  const tabIds = unique(tabs);

  const folders = list(state.folders).map(item => {
    const row = record(item, ["id", "tabId", "parentId", "title", "note", "linkedDocumentIds"]);
    return {
      id: id(row.id),
      tabId: id(row.tabId),
      parentId: row.parentId === null ? null : id(row.parentId),
      title: text(row.title, 80, true),
      note: text(row.note, 500),
      ...(row.linkedDocumentIds === undefined ? {} : {linkedDocumentIds:[...new Set(list(row.linkedDocumentIds).map(id))]}),
    };
  });
  const folderIds = unique(folders);
  for (const folder of folders) {
    if (!tabIds.has(folder.tabId)) fail();
    if (folder.parentId) {
      const parent = folders.find(item => item.id === folder.parentId);
      if (!parent || parent.tabId !== folder.tabId || parent.id === folder.id) fail();
    }
    const visited = new Set([folder.id]);
    let parentId = folder.parentId;
    while (parentId) {
      if (visited.has(parentId)) fail();
      visited.add(parentId);
      parentId = folders.find(item => item.id === parentId)?.parentId ?? null;
    }
  }

  const documents = list(state.documents).map(item => {
    const row = record(item, ["id", "folderId", "fileId", "name", "mediaType", "size", "addedAt", "mapDocumentId"]);
    const size = integer(row.size);
    if (size > 50 * 1024 * 1024) fail();
    return {
      id: id(row.id),
      folderId: id(row.folderId),
      fileId: id(row.fileId),
      name: text(row.name, 1024, true),
      mediaType: text(row.mediaType, 127),
      size,
      addedAt: text(row.addedAt, 64, true),
      ...(row.mapDocumentId === undefined ? {} : { mapDocumentId: text(row.mapDocumentId, 150, true) }),
    };
  });
  const documentIds = unique(documents);
  for (const folder of folders) {
    if (folder.linkedDocumentIds?.some(id => !documentIds.has(id))) fail();
  }
  for (const document of documents) {
    if (!folderIds.has(document.folderId) || document.fileId !== document.id) fail();
    if (document.mapDocumentId !== undefined &&
      (!/^[a-zA-Z0-9_.:-]{1,150}$/.test(document.mapDocumentId) || !/^map_[a-f0-9]{64}$/.test(document.id))) fail();
  }
  unique(documents.filter(item => item.mapDocumentId !== undefined), "mapDocumentId");

  const mapLinks = list(state.mapLinks ?? []).map(item => {
    const row = record(item, ["documentId", "fieldId", "categoryId", "term"]);
    if (!documentIds.has(row.documentId)) fail();
    return {
      documentId: id(row.documentId),
      fieldId: id(row.fieldId),
      categoryId: id(row.categoryId),
      term: text(row.term, 150, true),
    };
  });
  if (new Set(mapLinks.map(item => JSON.stringify(item))).size !== mapLinks.length) fail();

  const textSegments = list(state.textSegments).map(item => {
    const row = record(item, ["id", "sourceId", "segmentNumber", "pageNumber", "text"]);
    const segment = {
      id: id(row.id),
      sourceId: id(row.sourceId),
      segmentNumber: integer(row.segmentNumber),
      pageNumber: row.pageNumber === null ? null : integer(row.pageNumber, 1),
      text: text(row.text, MAX_TEXT),
    };
    return segment;
  });
  const segmentIds = unique(textSegments);
  for (const segment of textSegments) if (!documentIds.has(segment.sourceId)) fail();
  for (const document of documents) {
    const numbers = new Set();
    for (const segment of textSegments.filter(item => item.sourceId === document.id)) {
      if (numbers.has(segment.segmentNumber)) fail();
      numbers.add(segment.segmentNumber);
    }
  }

  const favoriteWords = list(state.favoriteWords).map(item => {
    const row = record(item, ["id", "word", "normalizedWord", "note"]);
    return {
      id: id(row.id),
      word: text(row.word, 120, true),
      normalizedWord: text(row.normalizedWord, 240, true),
      note: text(row.note, 500),
    };
  });
  const favoriteIds = unique(favoriteWords);
  unique(favoriteWords, "normalizedWord");

  const readingPositions = list(state.readingPositions).map(item => {
    const row = record(item, ["documentId", "pageIndex", "scrollFraction"]);
    if (typeof row.scrollFraction !== "number" || !Number.isFinite(row.scrollFraction) ||
      row.scrollFraction < 0 || row.scrollFraction > 1) fail();
    return {
      documentId: id(row.documentId),
      pageIndex: integer(row.pageIndex),
      scrollFraction: row.scrollFraction,
    };
  });
  unique(readingPositions, "documentId");
  for (const position of readingPositions) if (!documentIds.has(position.documentId)) fail();

  const readingMarkers = list(state.readingMarkers).map(item => {
    const row = record(item, ["documentId", "segmentIndex", "startOffset", "endOffset"]);
    const startOffset = integer(row.startOffset), endOffset = integer(row.endOffset, 1);
    if (endOffset <= startOffset) fail();
    return {
      documentId: id(row.documentId),
      segmentIndex: integer(row.segmentIndex),
      startOffset,
      endOffset,
    };
  });
  unique(readingMarkers, "documentId");
  for (const marker of readingMarkers) {
    if (!documentIds.has(marker.documentId)) fail();
    const segment = textSegments.filter(item => item.sourceId === marker.documentId)[marker.segmentIndex];
    if (!segment || marker.endOffset > segment.text.length) fail();
  }

  const wordCollections = list(state.wordCollections).map(item => {
    const row = record(item, [
      "id", "favoriteId", "kind", "parentTabId", "title", "note",
      "excludedDocumentIds", "includedDocumentIds", "uploadFolderId",
    ]);
    if (row.kind !== "tab" && row.kind !== "folder") fail();
    return {
      id: id(row.id),
      favoriteId: id(row.favoriteId),
      kind: row.kind,
      parentTabId: row.parentTabId === null ? null : id(row.parentTabId),
      title: text(row.title, 120, true),
      note: text(row.note, 500),
      excludedDocumentIds: list(row.excludedDocumentIds).map(id),
      includedDocumentIds: list(row.includedDocumentIds).map(id),
      uploadFolderId: row.uploadFolderId === null ? null : id(row.uploadFolderId),
    };
  });
  unique(wordCollections);
  for (const collection of wordCollections) {
    if (!favoriteIds.has(collection.favoriteId) ||
      (collection.kind === "tab" && collection.parentTabId !== null) ||
      (collection.parentTabId !== null && !tabIds.has(collection.parentTabId)) ||
      (collection.uploadFolderId !== null && !folderIds.has(collection.uploadFolderId)) ||
      collection.excludedDocumentIds.some(value => !documentIds.has(value)) ||
      collection.includedDocumentIds.some(value => !documentIds.has(value))) fail();
    if (new Set([...collection.excludedDocumentIds, ...collection.includedDocumentIds]).size !==
      collection.excludedDocumentIds.length + collection.includedDocumentIds.length) fail();
  }

  const editedTexts = list(state.editedTexts).map(item => {
    const row = record(item, ["documentId", "text"]);
    return { documentId: id(row.documentId), text: text(row.text, MAX_TEXT) };
  });
  unique(editedTexts, "documentId");
  for (const edited of editedTexts) if (!documentIds.has(edited.documentId)) fail();

  return {
    version: 1,
    tabs,
    folders,
    documents,
    textSegments,
    favoriteWords,
    readingPositions,
    readingMarkers,
    wordCollections,
    editedTexts,
    mapLinks,
  };
}

function normalizedWithOffsets(value) {
  let text = "";
  const starts = [], ends = [];
  let offset = 0;
  for (const character of value) {
    const end = offset + character.length;
    let part = character.normalize("NFD").toLowerCase().replace(/\p{M}/gu, "");
    if (!part && /\p{M}/u.test(character) && ends.length) ends[ends.length - 1] = end;
    if (/\s/u.test(character)) {
      if (text.endsWith(" ")) {
        ends[ends.length - 1] = end;
        offset = end;
        continue;
      }
      part = " ";
    }
    for (let index = 0; index < part.length; index += 1) {
      text += part[index];
      starts.push(offset);
      ends.push(end);
    }
    offset = end;
  }
  return { text, starts, ends };
}

function textSources(state) {
  const tabs = new Map(state.tabs.map(item => [item.id, item.title]));
  const folders = new Map(state.folders.map(item => [item.id, item]));
  const segments = new Map();
  for (const segment of state.textSegments) {
    const values = segments.get(segment.sourceId) ?? [];
    values.push(segment);
    segments.set(segment.sourceId, values);
  }
  const edited = new Map(state.editedTexts.map(item => [item.documentId, item.text]));
  const sources = [];
  for (const tab of state.tabs) sources.push({ kind: "grimoire-tab", id: tab.id, title: tab.title, text: tab.title });
  for (const folder of state.folders) {
    const parents = [];
    let parentId = folder.parentId;
    while (parentId) {
      const parent = folders.get(parentId);
      if (!parent) break;
      parents.unshift(parent.title);
      parentId = parent.parentId;
    }
    const path = [tabs.get(folder.tabId), ...parents, folder.title].filter(Boolean).join(" → ");
    sources.push({ kind: "grimoire-folder", id: folder.id, title: folder.title, text: `${path}\n${folder.note}` });
  }
  for (const document of state.documents) {
    const folder = folders.get(document.folderId);
    const path = folder ? `${tabs.get(folder.tabId) ?? ""} → ${folder.title}` : "";
    const indexedText = (segments.get(document.id) ?? []).sort((a, b) => a.segmentNumber - b.segmentNumber).map(item => item.text).join("\n\n");
    sources.push({
      kind: "grimoire-document",
      id: document.id,
      title: document.name,
      text: [path, document.name, edited.get(document.id) ?? "", indexedText].filter(Boolean).join("\n"),
    });
  }
  for (const favorite of state.favoriteWords) sources.push({
    kind: "grimoire-favorite",
    id: favorite.id,
    title: favorite.word,
    text: `${favorite.word}\n${favorite.note}`,
  });
  const favorites = new Map(state.favoriteWords.map(item => [item.id, item.word]));
  for (const collection of state.wordCollections) sources.push({
    kind: "grimoire-collection",
    id: collection.id,
    title: collection.title,
    text: `${favorites.get(collection.favoriteId) ?? ""}\n${collection.title}\n${collection.note}`,
  });
  return sources;
}

export function searchState(raw, query) {
  const state = validateState(raw);
  if (typeof query !== "string" || !query.trim() || query.length > 150) fail("Zadaj výraz do 150 znakov.");
  const needle = normalizedWithOffsets(query.trim()).text;
  if (!needle.trim()) fail("Zadaj výraz do 150 znakov.");
  const results = [];
  for (const source of textSources(state)) {
    const haystack = normalizedWithOffsets(source.text);
    let cursor = 0, occurrences = 0, first = -1;
    while ((cursor = haystack.text.indexOf(needle, cursor)) >= 0) {
      if (first < 0) first = cursor;
      occurrences += 1;
      cursor += needle.length;
    }
    if (first < 0) continue;
    const originalStart = haystack.starts[first], originalEnd = haystack.ends[first + needle.length - 1];
    const start = Math.max(0, originalStart - 80), end = Math.min(source.text.length, originalEnd + 140);
    results.push({
      kind: source.kind,
      id: source.id,
      title: source.title,
      text: source.text.slice(start, end),
      occurrences,
    });
    if (results.length >= 100) break;
  }
  return results;
}

export function collectionSourceIds(state, collectionId) {
  const collection = state.wordCollections.find(item => item.id === collectionId);
  if (!collection) fail("Slovná kolekcia už nie je dostupná.");
  const word = state.favoriteWords.find(item => item.id === collection.favoriteId)?.word;
  if (!word) fail("Pôvodný termín kolekcie už nie je dostupný.");
  const needle = normalizedWithOffsets(word.trim()).text;
  const exact = value => {
    const haystack = normalizedWithOffsets(value).text;
    let offset = 0;
    while (needle && (offset = haystack.indexOf(needle, offset)) >= 0) {
      const before = Array.from(haystack.slice(0, offset)).at(-1) ?? "";
      const after = Array.from(haystack.slice(offset + needle.length))[0] ?? "";
      if (!/[\p{L}\p{N}_]/u.test(before) && !/[\p{L}\p{N}_]/u.test(after)) return true;
      offset += needle.length;
    }
    return false;
  };
  return state.documents.filter(document => !collection.excludedDocumentIds.includes(document.id) &&
    (collection.includedDocumentIds.includes(document.id) ||
      state.textSegments.some(segment => segment.sourceId === document.id && exact(segment.text)))).map(item => item.id);
}

export function terminologySources(raw, details, strict = true) {
  const state = validateState(raw);
  const documentIds = new Set(state.documents.map(item => item.id));
  const folderIds = new Set(state.folders.map(item => item.id));
  const collectionIds = new Set(state.wordCollections.map(item => item.id));
  if (strict && (details.documentIds.some(id => !documentIds.has(id)) ||
    details.folderIds.some(id => !folderIds.has(id)) || details.collectionIds.some(id => !collectionIds.has(id)))) {
    fail("Niektorý zdroj nepatrí aktuálnemu Grimoáru. Obnov katalóg a vyber dostupné dokumenty.");
  }
  const folders = new Set(details.folderIds.filter(id => folderIds.has(id)));
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of state.folders) {
      if (folders.has(folder.parentId) && !folders.has(folder.id)) { folders.add(folder.id); changed = true; }
    }
  }
  const sources = new Set(details.documentIds.filter(id => documentIds.has(id)));
  for (const document of state.documents) if (folders.has(document.folderId)) sources.add(document.id);
  for (const folder of state.folders) if (folders.has(folder.id)) {
    for (const id of folder.linkedDocumentIds ?? []) sources.add(id);
  }
  for (const id of details.collectionIds.filter(id => collectionIds.has(id))) {
    for (const sourceId of collectionSourceIds(state, id)) sources.add(sourceId);
  }
  return [...sources].sort();
}

export default Object.freeze({ createState, searchState, validateState, collectionSourceIds, terminologySources });
