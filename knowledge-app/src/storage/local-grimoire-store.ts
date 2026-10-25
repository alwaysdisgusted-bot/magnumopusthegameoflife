import type { GrimoireDocument, GrimoireFolder, GrimoireTab } from '../grimoire/models'
import { isSupportedDocument } from '../grimoire/documents'
import type { Source, TextSegment } from '../sources/models'
import type { SourcePage, TextDocumentStore } from './source-store'
import type { GrimoireStore } from './grimoire-store'
import { folderSubtreeIds } from './grimoire-store'
import { normalizedTextWithOffsets } from '../search/text-normalization'
import { validateNote, type FavoriteWord, type FavoriteWordStore } from './favorite-word-store'
import type { ReadingPosition, ReadingPositionStore } from './reading-position-store'
import type { ReadingMarker, ReadingMarkerStore } from './reading-marker-store'
import type { WordCollection, WordCollectionStore } from './word-collection-store'
import { validateEditedText, type EditedTextStore } from './edited-text-store'

const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_ITEMS = 10000

interface StoredDocument {
  id: string
  folderId: string
  fileId: string
  name: string
  mediaType: string
  size: number
  addedAt: string
  mapDocumentId?: string
}

export interface MapDocument {
  id: string
  name: string
  size: number
  mime: string
  text: string
  pages: Array<{ number: number; text: string }>
  blob?: Blob
}

export interface MapDocumentStore {
  getDocuments(): Promise<MapDocument[]>
  getValue?(key: string, fallback: unknown): Promise<unknown>
}

export interface MapLink {
  documentId: string
  fieldId: string
  categoryId: string
  term: string
}

export interface TreeTerm {
  id: string; revision: number; fieldId: string; categoryId: string; term: string;
  description: string; note: string; documentIds: string[]; folderIds: string[];
  collectionIds: string[]; sourceIds: string[]; rewarded: boolean
  parent?: {termId: string} | {term: string} | null
  folderPath?: Array<{key: string; title: string}>
}

export interface TerminologyCatalog {
  terms: TreeTerm[]
  favoriteWords: FavoriteWord[]
  collections: Array<WordCollection & { sourceIds: string[] }>
  folders: GrimoireFolder[]
  tabs: GrimoireTab[]
  documents: StoredDocument[]
}

interface StoredTextSegment {
  id: string
  sourceId: string
  segmentNumber: number
  pageNumber: number | null
  text: string
}

export interface GrimoireSnapshot {
  version: 1
  tabs: GrimoireTab[]
  folders: GrimoireFolder[]
  documents: StoredDocument[]
  textSegments: StoredTextSegment[]
  favoriteWords: FavoriteWord[]
  readingPositions: Array<ReadingPosition & { documentId: string }>
  readingMarkers: Array<ReadingMarker & { documentId: string }>
  wordCollections: Array<Omit<WordCollection, 'word'>>
  editedTexts: Array<{ documentId: string; text: string }>
  mapLinks?: MapLink[]
}

interface SnapshotResponse {
  state: GrimoireSnapshot
  revision: number
  updatedAt: number | null
}

interface GrimoireWriteResponse {
  revision: number
}

interface ApiErrorPayload {
  error?: { message?: string }
}

async function responseError(response: Response): Promise<Error> {
  try {
    const payload = await response.json() as ApiErrorPayload
    if (typeof payload.error?.message === 'string') return new Error(payload.error.message)
  } catch { /* Preserve an explicit HTTP failure when the body is malformed. */ }
  return new Error(`Požiadavka Grimoára zlyhala (HTTP ${response.status}).`)
}

async function readJsonResponse<T = unknown>(response: Response): Promise<T> {
  let payload: T
  try { payload = await response.json() as T }
  catch { throw new Error('Lokálne úložisko Grimoára vrátilo neplatnú odpoveď.') }
  if (!response.ok) {
    const detail = payload && typeof payload === 'object' && 'error' in payload
      ? (payload as ApiErrorPayload).error?.message
      : undefined
    throw new Error(typeof detail === 'string' ? detail : `Požiadavka Grimoára zlyhala (HTTP ${response.status}).`)
  }
  return payload
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function requireTitle(title: string, maximum = 80): string {
  const value = title.trim()
  if (!value || value.length > maximum) throw new Error(`Názov musí mať 1 až ${maximum} znakov.`)
  return value
}

export class LocalGrimoireApi {
  private constructor(private readonly csrf: string, private readonly fetcher: typeof fetch) {}

  static async connect(fetcher: typeof fetch = (...args) => fetch(...args)): Promise<LocalGrimoireApi> {
    const response = await fetcher('/api/auth/session', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-MO-Request': '1', Accept: 'application/json' },
    })
    const payload = await readJsonResponse<{ account?: { id?: string }; csrf?: string; localMode?: boolean }>(response)
    if (!payload.account?.id || typeof payload.csrf !== 'string') {
      throw new Error('Najprv otvor lokálny profil hry a potom obnov Grimoár.')
    }
    if (payload.localMode !== true) throw new Error('Grimoár sa pripája iba k lokálnemu účtu tejto hry.')
    return new LocalGrimoireApi(payload.csrf, fetcher)
  }

  async load(): Promise<SnapshotResponse> {
    return readJsonResponse(await this.fetcher('/api/knowledge/grimoire', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-MO-Request': '1', Accept: 'application/json' },
    }))
  }

  async terminology(): Promise<TerminologyCatalog> {
    return readJsonResponse(await this.fetcher('/api/knowledge/grimoire/terminology', {
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { 'X-MO-Request': '1', Accept: 'application/json' },
    }))
  }

  async save(expectedRevision: number, state: GrimoireSnapshot): Promise<GrimoireWriteResponse> {
    return this.request<GrimoireWriteResponse>('/api/knowledge/grimoire', 'PUT', { expectedRevision, state })
  }

  async uploadFile(id: string, file: File): Promise<void> {
    const form = new FormData()
    form.set('id', id)
    form.set('file', file, file.name)
    const response = await this.fetcher('/api/knowledge/grimoire/files', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-MO-Request': '1', 'X-MO-CSRF': this.csrf, Accept: 'application/json' },
      body: form,
    })
    await readJsonResponse(response)
  }

  async deleteFile(id: string): Promise<void> {
    await this.request(`/api/knowledge/grimoire/files/${encodeURIComponent(id)}`, 'DELETE', {})
  }

  async downloadFile(id: string): Promise<Blob> {
    const response = await this.fetcher(`/api/knowledge/grimoire/files/${encodeURIComponent(id)}`, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-MO-Request': '1' },
    })
    if (!response.ok) throw await responseError(response)
    return response.blob()
  }

  async search(query: string, signal?: AbortSignal) {
    const response = await this.fetcher(`/api/knowledge/grimoire/search?q=${encodeURIComponent(query)}`, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-MO-Request': '1', Accept: 'application/json' },
      signal,
    })
    return readJsonResponse<{ results: Array<{ kind: string; id: string; title: string; text: string; occurrences: number }> }>(response)
  }

  private async request<T = { ok: boolean }>(
    path: string,
    method: 'POST' | 'PUT' | 'DELETE',
    body?: unknown,
  ): Promise<T> {
    const response = await this.fetcher(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'X-MO-Request': '1',
        'X-MO-CSRF': this.csrf,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return readJsonResponse<T>(response)
  }
}

export class LocalGrimoireDatabase {
  private state: GrimoireSnapshot
  private revision: number
  private writes: Promise<void> = Promise.resolve()

  private constructor(readonly api: LocalGrimoireApi, snapshot: SnapshotResponse) {
    this.state = snapshot.state
    this.revision = snapshot.revision
  }

  static async load(api: LocalGrimoireApi): Promise<LocalGrimoireDatabase> {
    return new LocalGrimoireDatabase(api, await api.load())
  }

  read(): GrimoireSnapshot { return this.state }

  async organizeTermDocuments(term: TreeTerm, mapDocumentIds: string[]): Promise<void> {
    if (!term.folderPath?.length) throw new Error('Server neposlal cestu nadradených bublín.')
    const path = await Promise.all(term.folderPath.map(async item => ({
      id: 'tree_' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
        new TextEncoder().encode(item.key))), byte => byte.toString(16).padStart(2,'0')).join(''),
      title: item.title.slice(0,80),
    })))
    if (!mapDocumentIds.length) {
      if (!this.state.folders.some(folder => folder.id === path[path.length - 1].id)) return
      if (path.every((item,index) => this.state.folders.some(folder => folder.id === item.id &&
        folder.title === item.title && folder.parentId === (index ? path[index - 1].id : null)))) return
    }
    await this.transact(draft => {
      const documents = mapDocumentIds.map(id => {
        const document = draft.documents.find(item => item.mapDocumentId === id)
        if (!document) throw new Error('Nahraný originál ešte nie je dostupný v katalógu Grimoára.')
        return document
      })
      const tabId = 'map_documents'
      if (!draft.tabs.some(item => item.id === tabId)) draft.tabs.push({id:tabId,title:'Mapa stromu'})
      let parentId: string | null = null
      for (const item of path) {
        const folder = draft.folders.find(folder => folder.id === item.id)
        if (folder) {
          folder.parentId = parentId; folder.title = item.title
        } else draft.folders.push({id:item.id,tabId,parentId,title:item.title,note:''})
        parentId = item.id
      }
      for (const document of documents) {
        // Existing references keep their original location; the bubble includes them through explicit links.
        if (document.folderId === 'map_originals') document.folderId = path[path.length - 1].id
        else if (document.folderId !== path[path.length - 1].id) {
          const folder = draft.folders.find(item => item.id === path[path.length - 1].id)!
          folder.linkedDocumentIds = [...new Set([...(folder.linkedDocumentIds ?? []),document.id])]
        }
        const link = {documentId:document.id,fieldId:term.fieldId,categoryId:term.categoryId,term:term.term}
        draft.mapLinks ??= []
        if (!draft.mapLinks.some(item => JSON.stringify(item) === JSON.stringify(link))) draft.mapLinks.push(link)
      }
    })
  }

  async syncMapDocuments(store: MapDocumentStore): Promise<void> {
    const documents = await store.getDocuments()
    const references = await Promise.all(documents.map(async document => ({
      document,
      id: 'map_' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
        new TextEncoder().encode(document.id))), byte => byte.toString(16).padStart(2, '0')).join(''),
    })))
    const changed = references.some(({ document, id }) => {
      const existing = this.state.documents.find(item => item.id === id)
      const segments = this.state.textSegments.filter(item => item.sourceId === id)
      const pages = document.pages.length ? document.pages : [{ number: 1, text: document.text }]
      return !existing || existing.mapDocumentId !== document.id || existing.mediaType !== document.mime ||
        existing.name !== document.name || existing.size !== document.size ||
        segments.length !== pages.length || pages.some((page, index) =>
          segments[index]?.text !== page.text || segments[index]?.pageNumber !== page.number)
    })
    if (!changed) return
    await this.transact(draft => {
      const tabId = 'map_documents', folderId = 'map_originals'
      if (!draft.tabs.some(item => item.id === tabId)) draft.tabs.push({ id: tabId, title: 'Mapa stromu' })
      if (!draft.folders.some(item => item.id === folderId)) draft.folders.push({
        id: folderId, tabId, parentId: null, title: 'Dokumenty mapy', note: 'Odkazy na originály v miestnej Mape stromu. Originály sa nepresúvajú.',
      })
      for (const { document, id } of references) {
        const existing = draft.documents.find(item => item.id === id)
        const savedSegments = draft.textSegments.filter(item => item.sourceId === id)
        const pages = document.pages.length ? document.pages : [{ number: 1, text: document.text }]
        const sameText = savedSegments.length === pages.length &&
          pages.every((page, index) => savedSegments[index]?.text === page.text)
        const samePages = sameText && pages.every((page, index) => savedSegments[index]?.pageNumber === page.number)
        if (existing?.mapDocumentId === document.id && existing?.name === document.name &&
          existing.mediaType === document.mime && existing.size === document.size && samePages) continue
        if (existing && existing.mapDocumentId !== document.id) throw new Error('Konflikt identity mapového dokumentu.')
        const metadata = {
          id, folderId: existing?.folderId ?? folderId, fileId: id, mapDocumentId: document.id,
          name: document.name, mediaType: document.mime, size: document.size,
          addedAt: existing?.addedAt ?? new Date().toISOString(),
        }
        if (existing) Object.assign(existing, metadata)
        else draft.documents.push(metadata)
        if (!samePages) {
          draft.textSegments = draft.textSegments.filter(item => item.sourceId !== id)
          draft.textSegments.push(...pages.map((page, segmentNumber) => ({
            id: crypto.randomUUID(), sourceId: id, segmentNumber, pageNumber: page.number, text: page.text,
          })))
        }
        if (!sameText) draft.readingMarkers = draft.readingMarkers.filter(item => item.documentId !== id)
      }
    })
  }

  async setMapLink(link: MapLink, linked: boolean): Promise<void> {
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(link.fieldId) || !/^[a-zA-Z0-9_-]{1,160}$/.test(link.categoryId) ||
      !link.term.trim() || link.term.length > 150) throw new Error('Vyber platný uzol mapy.')
    await this.transact(draft => {
      if (!draft.documents.some(item => item.id === link.documentId)) throw new Error('Dokument už nie je dostupný.')
      const same = (item: MapLink) => item.documentId === link.documentId && item.fieldId === link.fieldId &&
        item.categoryId === link.categoryId && item.term === link.term
      draft.mapLinks ??= []
      if (linked && !draft.mapLinks.some(same)) draft.mapLinks.push({ ...link })
      if (!linked) draft.mapLinks = draft.mapLinks.filter(item => !same(item))
    })
  }

  async refresh(): Promise<void> {
    const snapshot = await this.api.load()
    this.state = snapshot.state
    this.revision = snapshot.revision
  }

  transact<T>(update: (draft: GrimoireSnapshot) => Promise<T> | T): Promise<T> {
    const operation = this.writes.then(async () => {
      const draft = clone(this.state)
      const result = await update(draft)
      const saved = await this.api.save(this.revision, draft)
      this.state = draft
      this.revision = saved.revision
      return result
    })
    this.writes = operation.then(() => undefined, () => undefined)
    return operation
  }

}

export class LocalGrimoireStore implements GrimoireStore {
  constructor(private readonly database: LocalGrimoireDatabase, private readonly mapStore?: MapDocumentStore) {}

  listTabs(): GrimoireTab[] { return clone(this.database.read().tabs) }
  listFolders(tabId: string): GrimoireFolder[] {
    return clone(this.database.read().folders.filter(item => item.tabId === tabId))
  }
  listDocuments(folderId: string): GrimoireDocument[] {
    const linked = this.database.read().folders.find(item => item.id === folderId)?.linkedDocumentIds ?? []
    return clone(this.database.read().documents.filter(item => item.folderId === folderId || linked.includes(item.id))
      .map(item => ({ ...item, storagePath: item.fileId })))
  }

  createTab(title: string): Promise<GrimoireTab> {
    return this.database.transact(draft => {
      const tab = { id: crypto.randomUUID(), title: requireTitle(title) }
      draft.tabs.push(tab)
      return clone(tab)
    })
  }

  createFolder(tabId: string, parentId: string | null, title: string): Promise<GrimoireFolder> {
    return this.database.transact(draft => {
      if (!draft.tabs.some(item => item.id === tabId)) throw new Error('Vybraná záložka neexistuje.')
      if (parentId && !draft.folders.some(item => item.id === parentId && item.tabId === tabId)) {
        throw new Error('Nadradený priečinok neexistuje.')
      }
      const folder = { id: crypto.randomUUID(), tabId, parentId, title: requireTitle(title), note: '' }
      draft.folders.push(folder)
      return clone(folder)
    })
  }

  renameTab(tabId: string, title: string): Promise<void> {
    return this.database.transact(draft => {
      const tab = draft.tabs.find(item => item.id === tabId)
      if (!tab) throw new Error('Záložka neexistuje.')
      tab.title = requireTitle(title)
    })
  }

  renameFolder(folderId: string, title: string): Promise<void> {
    return this.database.transact(draft => {
      const folder = draft.folders.find(item => item.id === folderId)
      if (!folder) throw new Error('Priečinok neexistuje.')
      folder.title = requireTitle(title)
    })
  }

  saveFolderDetails(folderId: string, title: string, note: string): Promise<void> {
    const value = requireTitle(title)
    validateNote(note)
    return this.database.transact(draft => {
      const folder = draft.folders.find(item => item.id === folderId)
      if (!folder) throw new Error('Priečinok neexistuje.')
      folder.title = value
      folder.note = note
    })
  }

  mergeFolders(sourceId: string, targetId: string): Promise<void> {
    return this.database.transact(draft => {
      const source = draft.folders.find(item => item.id === sourceId)
      const target = draft.folders.find(item => item.id === targetId)
      if (!source || !target || source.tabId !== target.tabId || folderSubtreeIds(draft.folders, sourceId).has(targetId)) {
        throw new Error('Zvoľ iný priečinok v rovnakej záložke, nie jeho podpriečinok.')
      }
      for (const document of draft.documents) if (document.folderId === sourceId) document.folderId = targetId
      for (const folder of draft.folders) if (folder.parentId === sourceId) folder.parentId = targetId
      target.linkedDocumentIds = [...new Set([...(target.linkedDocumentIds ?? []),...(source.linkedDocumentIds ?? [])])]
      draft.folders.splice(draft.folders.indexOf(source), 1)
      for (const collection of draft.wordCollections) if (collection.uploadFolderId === sourceId) collection.uploadFolderId = targetId
    })
  }

  async deleteFolder(folderId: string, expectedDocumentIds?: readonly string[]): Promise<void> {
    const removed = await this.database.transact(draft => {
      if (!draft.folders.some(item => item.id === folderId)) throw new Error('Priečinok neexistuje.')
      const ids = folderSubtreeIds(draft.folders, folderId)
      if (draft.documents.some(item => ids.has(item.folderId) && item.mapDocumentId !== undefined)) {
        throw new Error('Tento priečinok obsahuje odkazy na originály Mapy stromu. Originály ani ich katalóg sa touto akciou nemažú.')
      }
      const documentIds = draft.documents.filter(item => ids.has(item.folderId)).map(item => item.id)
      const displayedIds = new Set([...documentIds,...draft.folders.filter(folder => ids.has(folder.id))
        .flatMap(folder => folder.linkedDocumentIds ?? [])])
      if (expectedDocumentIds && (displayedIds.size !== expectedDocumentIds.length ||
        [...displayedIds].some(id => !expectedDocumentIds.includes(id)))) {
        throw new Error('Obsah priečinka sa zmenil. Zavrite ponuku a potvrďte aktuálny obsah znova.')
      }
      draft.documents = draft.documents.filter(item => !ids.has(item.folderId))
      for (const folder of draft.folders) if (folder.linkedDocumentIds) folder.linkedDocumentIds = folder.linkedDocumentIds.filter(id => !documentIds.includes(id))
      draft.mapLinks = draft.mapLinks?.filter(item => !documentIds.includes(item.documentId))
      draft.textSegments = draft.textSegments.filter(item => !documentIds.includes(item.sourceId))
      draft.editedTexts = draft.editedTexts.filter(item => !documentIds.includes(item.documentId))
      draft.readingPositions = draft.readingPositions.filter(item => !documentIds.includes(item.documentId))
      draft.readingMarkers = draft.readingMarkers.filter(item => !documentIds.includes(item.documentId))
      draft.folders = draft.folders.filter(item => !ids.has(item.id))
      for (const collection of draft.wordCollections) {
        if (collection.uploadFolderId && ids.has(collection.uploadFolderId)) collection.uploadFolderId = null
        collection.includedDocumentIds = collection.includedDocumentIds.filter(id => !documentIds.includes(id))
        collection.excludedDocumentIds = collection.excludedDocumentIds.filter(id => !documentIds.includes(id))
      }
      return documentIds
    })
    for (const id of removed) await this.database.api.deleteFile(id)
  }

  async addDocument(folderId: string, file: File): Promise<GrimoireDocument> {
    if (!isSupportedDocument(file.name)) throw new Error(`Formát súboru „${file.name}“ nie je podporovaný.`)
    if (!file.size || file.size > MAX_FILE_BYTES) throw new Error('Súbor musí mať 1 bajt až 50 MB.')
    const id = crypto.randomUUID()
    let uploaded = false
    try {
      return await this.database.transact(async draft => {
        if (!draft.folders.some(item => item.id === folderId)) throw new Error('Vybraný priečinok neexistuje.')
        await this.database.api.uploadFile(id, file)
        uploaded = true
        const document = {
          id, folderId, fileId: id, name: file.name,
          mediaType: file.type || 'application/octet-stream', size: file.size,
          addedAt: new Date().toISOString(),
        }
        draft.documents.push(document)
        return { ...document, storagePath: id }
      })
    } catch (error) {
      if (uploaded) {
        try { await this.database.api.deleteFile(id) }
        catch (cleanupError) {
          throw new Error(`${error instanceof Error ? error.message : String(error)} Originál mohol zostať v miestnom úložisku; upratanie zlyhalo: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`)
        }
      }
      throw error
    }
  }

  async removeDocument(documentId: string): Promise<void> {
    await this.database.transact(draft => {
      const index = draft.documents.findIndex(item => item.id === documentId)
      if (index < 0) throw new Error('Dokument už nie je dostupný.')
      if (draft.documents[index].mapDocumentId !== undefined) throw new Error('Originál zostáva v Mape stromu. V mape môžeš odstrániť iba jeho priradenie k uzlu.')
      draft.documents.splice(index, 1)
      for (const folder of draft.folders) if (folder.linkedDocumentIds) folder.linkedDocumentIds = folder.linkedDocumentIds.filter(id => id !== documentId)
      draft.mapLinks = draft.mapLinks?.filter(item => item.documentId !== documentId)
      draft.textSegments = draft.textSegments.filter(item => item.sourceId !== documentId)
      draft.editedTexts = draft.editedTexts.filter(item => item.documentId !== documentId)
      draft.readingPositions = draft.readingPositions.filter(item => item.documentId !== documentId)
      draft.readingMarkers = draft.readingMarkers.filter(item => item.documentId !== documentId)
      for (const collection of draft.wordCollections) {
        collection.includedDocumentIds = collection.includedDocumentIds.filter(id => id !== documentId)
        collection.excludedDocumentIds = collection.excludedDocumentIds.filter(id => id !== documentId)
      }
    })
    if (!documentId.startsWith('map_')) await this.database.api.deleteFile(documentId)
  }

  async downloadDocument(documentId: string): Promise<Blob> {
    const document = this.database.read().documents.find(item => item.id === documentId)
    if (!document) throw new Error('Dokument už nie je dostupný.')
    if (document.mapDocumentId !== undefined) {
      const original = (await this.mapStore?.getDocuments())?.find(item => item.id === document.mapDocumentId)
      if (!original?.blob) throw new Error('Originál zostáva v Mape stromu tohto prehliadača, ale momentálne nie je dostupný. Nič nebolo presunuté ani zmazané.')
      return original.blob
    }
    return this.database.api.downloadFile(documentId)
  }
}

export class LocalTextDocumentStore implements TextDocumentStore {
  constructor(private readonly database: LocalGrimoireDatabase) {}

  listSources(): Source[] {
    return this.database.read().documents.map(item => ({ id: item.id, title: item.name, kind: 'document', createdAt: item.addedAt }))
  }
  listTextSegments(): TextSegment[] {
    return this.database.read().textSegments.map(({ id, sourceId, text, pageNumber }) => ({
      id, sourceId, text, ...(pageNumber === null ? {} : { pageNumber }),
    }))
  }
  async addTextDocument(source: Source, text: string, pages?: readonly SourcePage[]): Promise<void> {
    return this.database.transact(draft => {
      if (!draft.documents.some(item => item.id === source.id)) throw new Error('Originálny dokument už nie je dostupný.')
      if (draft.textSegments.some(item => item.sourceId === source.id)) throw new Error(`Zdroj „${source.title}“ už bol pridaný.`)
      const sourcePages = pages?.length ? pages : [{ pageNumber: 0, text }]
      if (sourcePages.length > MAX_ITEMS) throw new Error('Textový index obsahuje príliš veľa strán.')
      draft.textSegments.push(...sourcePages.map((page, segmentNumber) => ({
        id: crypto.randomUUID(), sourceId: source.id, segmentNumber,
        pageNumber: page.pageNumber === 0 ? null : page.pageNumber, text: page.text,
      })))
    })
  }
  getText(sourceId: string): string | undefined {
    const segments = this.getTextSegments(sourceId)
    return segments.length ? segments.map(item => item.text).join('\n\n') : undefined
  }
  getTextSegments(sourceId: string): TextSegment[] {
    return this.database.read().textSegments.filter(item => item.sourceId === sourceId)
      .sort((a, b) => a.segmentNumber - b.segmentNumber)
      .map(item => ({ id: item.id, sourceId: item.sourceId, text: item.text,
        ...(item.pageNumber === null ? {} : { pageNumber: item.pageNumber }) }))
  }
  forgetDocuments(_sourceIds: readonly string[]): void {
    // Document deletion removes its text in the same snapshot commit.
  }
}

export class LocalFavoriteWordStore implements FavoriteWordStore {
  constructor(private readonly database: LocalGrimoireDatabase) {}
  async list(): Promise<FavoriteWord[]> { return clone(this.database.read().favoriteWords) }
  async add(word: string): Promise<FavoriteWord> {
    const value = word.trim()
    if (!value || value.length > 120) throw new Error('Výraz musí mať 1 až 120 znakov.')
    const normalizedWord = normalizedTextWithOffsets(value).text
    return this.database.transact(draft => {
      const existing = draft.favoriteWords.find(item => item.normalizedWord === normalizedWord)
      if (existing) return clone(existing)
      if (draft.favoriteWords.length >= MAX_ITEMS) throw new Error('Grimoár dosiahol limit obľúbených slov.')
      const favorite = { id: crypto.randomUUID(), word: value, normalizedWord, note: '' }
      draft.favoriteWords.push(favorite)
      return clone(favorite)
    })
  }
  async saveNote(id: string, note: string): Promise<void> {
    validateNote(note)
    return this.database.transact(draft => {
      const favorite = draft.favoriteWords.find(item => item.id === id)
      if (!favorite) throw new Error('Obľúbený výraz už nie je dostupný.')
      favorite.note = note
    })
  }
}

export class LocalReadingPositionStore implements ReadingPositionStore {
  constructor(private readonly database: LocalGrimoireDatabase) {}
  get(documentId: string): ReadingPosition | undefined {
    const item = this.database.read().readingPositions.find(value => value.documentId === documentId)
    return item ? { pageIndex: item.pageIndex, scrollFraction: item.scrollFraction } : undefined
  }
  async save(documentId: string, position: ReadingPosition): Promise<void> {
    if (!Number.isSafeInteger(position.pageIndex) || position.pageIndex < 0 ||
      !Number.isFinite(position.scrollFraction) || position.scrollFraction < 0 || position.scrollFraction > 1) {
      throw new Error('Poloha čítania nie je platná.')
    }
    return this.database.transact(draft => {
      if (!draft.documents.some(item => item.id === documentId)) throw new Error('Dokument už nie je dostupný.')
      const existing = draft.readingPositions.find(item => item.documentId === documentId)
      if (existing) Object.assign(existing, position)
      else draft.readingPositions.push({ documentId, ...position })
    })
  }
}

export class LocalReadingMarkerStore implements ReadingMarkerStore {
  constructor(private readonly database: LocalGrimoireDatabase) {}
  async get(documentId: string): Promise<ReadingMarker | undefined> {
    const item = this.database.read().readingMarkers.find(value => value.documentId === documentId)
    return item ? { segmentIndex: item.segmentIndex, startOffset: item.startOffset, endOffset: item.endOffset } : undefined
  }
  async set(documentId: string, marker: ReadingMarker | undefined): Promise<void> {
    if (marker && (![marker.segmentIndex, marker.startOffset, marker.endOffset].every(Number.isSafeInteger) ||
      marker.segmentIndex < 0 || marker.startOffset < 0 || marker.endOffset <= marker.startOffset)) {
      throw new Error('Značka čítania má neplatnú polohu.')
    }
    return this.database.transact(draft => {
      if (!draft.documents.some(item => item.id === documentId)) throw new Error('Dokument už nie je dostupný.')
      const index = draft.readingMarkers.findIndex(item => item.documentId === documentId)
      if (!marker) {
        if (index >= 0) draft.readingMarkers.splice(index, 1)
        return
      }
      const segments = draft.textSegments.filter(item => item.sourceId === documentId).sort((a, b) => a.segmentNumber - b.segmentNumber)
      const segment = segments[marker.segmentIndex]
      if (!segment || marker.endOffset > segment.text.length) throw new Error('Značka čítania je mimo uloženého textu.')
      const value = { documentId, ...marker }
      if (index >= 0) draft.readingMarkers[index] = value
      else draft.readingMarkers.push(value)
    })
  }
}

export class LocalWordCollectionStore implements WordCollectionStore {
  constructor(private readonly database: LocalGrimoireDatabase) {}
  list(): WordCollection[] {
    const state = this.database.read()
    return clone(state.wordCollections.map(item => ({...item,
      word: state.favoriteWords.find(favorite => favorite.id === item.favoriteId)?.word ?? ''})))
  }
  async create(favorite: FavoriteWord, parentTabId: string | null): Promise<WordCollection> {
    return this.database.transact(draft => {
      const storedFavorite = draft.favoriteWords.find(item => item.id === favorite.id)
      if (!storedFavorite) throw new Error('Obľúbené slovo už nie je dostupné.')
      const existing = draft.wordCollections.find(item => item.favoriteId === favorite.id && item.parentTabId === parentTabId)
      if (existing) return clone({...existing,word:storedFavorite.word})
      if (parentTabId && !draft.tabs.some(item => item.id === parentTabId)) throw new Error('Záložka už nie je dostupná.')
      const collection: Omit<WordCollection, 'word'> = {
        id: crypto.randomUUID(), favoriteId: storedFavorite.id,
        title: storedFavorite.word, note: '', kind: parentTabId ? 'folder' : 'tab',
        parentTabId, excludedDocumentIds: [], includedDocumentIds: [], uploadFolderId: null,
      }
      draft.wordCollections.push(collection)
      return clone({...collection,word:storedFavorite.word})
    })
  }
  async exclude(collectionId: string, documentId: string): Promise<void> {
    return this.update(collectionId, collection => {
      if (!collection.excludedDocumentIds.includes(documentId)) collection.excludedDocumentIds.push(documentId)
      collection.includedDocumentIds = collection.includedDocumentIds.filter(id => id !== documentId)
    })
  }
  async include(collectionId: string, documentId: string): Promise<void> {
    return this.update(collectionId, collection => {
      if (!collection.includedDocumentIds.includes(documentId)) collection.includedDocumentIds.push(documentId)
      collection.excludedDocumentIds = collection.excludedDocumentIds.filter(id => id !== documentId)
    })
  }
  async setUploadFolder(collectionId: string, folderId: string): Promise<void> {
    return this.update(collectionId, (collection, draft) => {
      if (!draft.folders.some(item => item.id === folderId)) throw new Error('Priečinok už nie je dostupný.')
      collection.uploadFolderId = folderId
    })
  }
  async saveDetails(collectionId: string, title: string, note: string): Promise<void> {
    const value = requireTitle(title, 120)
    validateNote(note)
    return this.update(collectionId, collection => { collection.title = value; collection.note = note })
  }
  private update(collectionId: string, change: (collection: Omit<WordCollection, 'word'>, draft: GrimoireSnapshot) => void): Promise<void> {
    return this.database.transact(draft => {
      const collection = draft.wordCollections.find(item => item.id === collectionId)
      if (!collection) throw new Error('Slovná kolekcia už nie je dostupná.')
      change(collection, draft)
    })
  }
}

export class LocalEditedTextStore implements EditedTextStore {
  constructor(private readonly database: LocalGrimoireDatabase) {}
  async get(documentId: string): Promise<string | undefined> {
    return this.database.read().editedTexts.find(item => item.documentId === documentId)?.text
  }
  async save(documentId: string, text: string): Promise<void> {
    validateEditedText(text)
    return this.database.transact(draft => {
      if (!draft.documents.some(item => item.id === documentId)) throw new Error('Dokument už nie je dostupný.')
      const existing = draft.editedTexts.find(item => item.documentId === documentId)
      if (existing) existing.text = text
      else draft.editedTexts.push({ documentId, text })
    })
  }
}
