import { mountSearchScreen, type SearchScreenControls } from './ui/search-screen'
import { InMemoryGrimoireStore } from './storage/grimoire-store'
import { InMemorySourceStore } from './storage/source-store'
import { showStartupError } from './ui/auth-screen'
import { isSearchQueryReady, type MapSearchNode } from './search/search-service'
import {
  LocalEditedTextStore,
  LocalFavoriteWordStore,
  LocalGrimoireApi,
  LocalGrimoireDatabase,
  LocalGrimoireStore,
  LocalReadingMarkerStore,
  LocalReadingPositionStore,
  LocalTextDocumentStore,
  LocalWordCollectionStore,
  type MapDocumentStore,
  type MapLink,
  type TreeTerm,
} from './storage/local-grimoire-store'
import './styles.css'
import './ui/grimoire-adapter.css'
import './ui/grimoire-atmosphere.css'
import '../../public/opus-theme.css'

const root = document.querySelector<HTMLElement>('#app')

if (!root) {
  throw new Error('Chýba koreňový prvok aplikácie.')
}
const appRoot = root
const bridgeChannel = 'magnum-opus-knowledge-bridge'
interface ReadingResult { turns: number; towardsReward: number; awarded: boolean }
const readingPending = new Map<string, {resolve: (value: ReadingResult) => void; reject: (error: Error) => void; timer: number}>()
function readingRequest(operation: 'status' | 'turn', data: Record<string, string | number> = {}): Promise<ReadingResult> {
  if (window.parent === window) return Promise.reject(new Error('Odmenu za listovanie otvor priamo v hre.'))
  const requestId = crypto.randomUUID()
  return new Promise((resolve,reject) => {
    const timer = window.setTimeout(() => {
      readingPending.delete(requestId); reject(new Error('Hra nepotvrdila otočenie. Zopakuj rovnaké potvrdenie.'))
    },30000)
    readingPending.set(requestId,{resolve,reject,timer})
    window.parent.postMessage({channel:bridgeChannel,version:2,type:'reading-request',requestId,operation,data},window.location.origin)
  })
}
window.addEventListener('message', event => {
  const message = event.data
  if (event.source !== window.parent || event.origin !== window.location.origin || !message ||
    Object.keys(message).sort().join('|') !== ['channel','version','type','requestId','ok','error','result'].sort().join('|') ||
    message.channel !== bridgeChannel || message.version !== 2 || message.type !== 'reading-response' ||
    typeof message.ok !== 'boolean' || typeof message.error !== 'string') return
  const pending = readingPending.get(message.requestId)
  if (!pending) return
  window.clearTimeout(pending.timer); readingPending.delete(message.requestId)
  if (!message.ok) { pending.reject(new Error(message.error)); return }
  const result = message.result
  if (!result || !Number.isSafeInteger(result.turns) || result.turns < 0 ||
    result.towardsReward !== result.turns % 25) { pending.reject(new Error('Neplatné potvrdenie počítadla.')); return }
  pending.resolve(result)
})
let localDatabase: LocalGrimoireDatabase | undefined
let mapStore: MapDocumentStore | undefined
let screenControls: SearchScreenControls | undefined
let documentRequests = Promise.resolve()
const cancelledDocuments = new Set<string>()
let mapNodes: MapSearchNode[] = []
let serverTerms: TreeTerm[] = []
let mapSourceErrors: string[] = []
let queryRevision = 0
let activeQuery = ''
let queryTimer = 0

interface MapCatalog {
  fields: Array<{ id: string; name: string; description: string;
    categories: Array<{ id: string; name: string; terms: string[]; authors: string[] }> }>
}

declare global {
  interface Window {
    MOKnowledgeStore?: MapDocumentStore
    MOKnowledgeCatalog?: MapCatalog
  }
}

function setActiveQuery(query: string): number {
  if (activeQuery !== query.trim()) {
    activeQuery = query.trim(); queryRevision += 1
    screenControls?.cancelPendingOpen()
  }
  return queryRevision
}

function announceQuery(query: string): void {
  if (window.parent !== window) window.parent.postMessage({
    channel: bridgeChannel, version: 2, type: 'query-changed', query: query.trim().slice(0, 150),
  }, window.location.origin)
}

async function refreshMapSources(): Promise<void> {
  mapSourceErrors = []
  try {
    if (!mapStore || !localDatabase) throw new Error('Adaptér originálov Mapy stromu nie je dostupný.')
    await localDatabase.syncMapDocuments(mapStore)
    const catalog = window.MOKnowledgeCatalog
    if (!catalog) throw new Error('Katalóg uzlov Mapy stromu sa nenačítal.')
    serverTerms = (await localDatabase.api.terminology()).terms
    for (const term of serverTerms) if (term.folderPath) await localDatabase.organizeTermDocuments(term, [])
    const custom: unknown = await mapStore.getValue?.('terms', {})
    if (!custom || typeof custom !== 'object' || Array.isArray(custom)) throw new Error('Uloženú terminológiu mapy nemožno načítať.')
    const nodes: MapSearchNode[] = []
    for (const field of catalog.fields) {
      const branches = Reflect.get(custom, field.id)
      for (const category of field.categories) {
        const saved: unknown = branches && typeof branches === 'object' ? Reflect.get(branches, category.id) : []
        if (saved !== undefined && !Array.isArray(saved)) throw new Error('Uložená vetva mapy má neplatný formát.')
        const entries: Array<{ term: string; description: string }> = []
        for (const entry of saved ?? []) {
          if (!entry || typeof entry.term !== 'string' || typeof entry.description !== 'string') {
            throw new Error('Uložený pojem mapy má neplatný formát.')
          }
          entries.push({ term: entry.term, description: entry.description })
        }
        for (const entry of [...category.terms.map(term => ({ term, description: '' })), ...entries]) {
          nodes.push({ id: JSON.stringify([field.id, category.id, entry.term]),
            fieldId: field.id, categoryId: category.id, term: entry.term,
            title: `${field.name} → ${category.name}`,
            description: entry.description })
        }
      }
    }
    mapNodes = nodes
    for (const term of serverTerms) {
      const field = catalog.fields.find(item => item.id === term.fieldId)
      const category = field?.categories.find(item => item.id === term.categoryId)
      if (field && category) mapNodes.push({ id: term.id, fieldId: term.fieldId, categoryId: term.categoryId,
        term: term.term, title: `${field.name} → ${category.name}`, description: `${term.description}\n${term.note}` })
    }
  } catch (error) {
    mapSourceErrors = [`Mapa stromu: ${error instanceof Error ? error.message : 'Zdroj nie je dostupný.'}`]
  }
}

  function validLegacyRequest(message: unknown): message is {
    requestId: string; operation: string; data: Record<string, unknown>
  } {
    if (!hasExactKeys(message, ['channel','version','type','requestId','operation','data']) ||
      message.channel !== bridgeChannel || message.version !== 2 || message.type !== 'terminology-request' ||
      typeof message.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(message.requestId)) return false
    const id = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value)
    const data = message.data
    if (message.operation === 'term-folder') return hasExactKeys(data,['id','mapDocumentIds']) && id(data.id) &&
      Array.isArray(data.mapDocumentIds) && data.mapDocumentIds.length > 0 && data.mapDocumentIds.length <= 100 && data.mapDocumentIds.every(id)
    if (message.operation === 'legacy-note') return hasExactKeys(data,['id','note']) && id(data.id) && typeof data.note === 'string' && data.note.length <= 500
    if (message.operation === 'legacy-collection') return hasExactKeys(data,['id','parentTabId']) && id(data.id) && (data.parentTabId === null || id(data.parentTabId))
    if (message.operation === 'legacy-details') return hasExactKeys(data,['id','title','note']) && id(data.id) &&
      typeof data.title === 'string' && !!data.title.trim() && data.title.length <= 120 && typeof data.note === 'string' && data.note.length <= 500
    if (['legacy-include','legacy-exclude','legacy-folder'].includes(String(message.operation))) {
      return hasExactKeys(data,['id','targetId']) && id(data.id) && id(data.targetId)
    }
    return false
  }

  async function handleLegacyRequest(message: { requestId: string; operation: string; data: Record<string, unknown> }): Promise<void> {
    try {
      if (!localDatabase) throw new Error('Grimoár ešte nie je pripravený.')
      const favorites = new LocalFavoriteWordStore(localDatabase)
      const collections = new LocalWordCollectionStore(localDatabase)
      const data = message.data, id = String(data.id)
      if (message.operation === 'term-folder') {
        await refreshMapSources()
        const term = (await localDatabase.api.terminology()).terms.find(item => item.id === id)
        if (!term) throw new Error('Bublina nepatrí aktuálnemu účtu.')
        await localDatabase.organizeTermDocuments(term, data.mapDocumentIds as string[])
      } else if (message.operation === 'legacy-note') await favorites.saveNote(id, String(data.note))
      else if (message.operation === 'legacy-collection') {
        const favorite = (await favorites.list()).find(item => item.id === id)
        if (!favorite) throw new Error('Pôvodný termín nie je dostupný.')
        await collections.create(favorite, data.parentTabId === null ? null : String(data.parentTabId))
      } else if (message.operation === 'legacy-details') await collections.saveDetails(id, String(data.title), String(data.note))
      else if (message.operation === 'legacy-folder') await collections.setUploadFolder(id, String(data.targetId))
      else {
        if (!localDatabase.read().documents.some(item => item.id === data.targetId)) throw new Error('Dokument nie je dostupný.')
        if (message.operation === 'legacy-include') await collections.include(id, String(data.targetId))
        else await collections.exclude(id, String(data.targetId))
      }
      screenControls?.refresh()
      window.parent.postMessage({channel:bridgeChannel,version:2,type:'document-response',requestId:message.requestId,
        ok:true,error:'',result:await localDatabase.api.terminology()},window.location.origin)
    } catch (error) {
      window.parent.postMessage({channel:bridgeChannel,version:2,type:'document-response',requestId:message.requestId,
        ok:false,error:error instanceof Error ? error.message : 'Kolekcia sa neuložila.',result:null},window.location.origin)
    }
  }

function validSearchRequest(message: unknown): message is {
  channel: string; version: number; type: string; requestId: string
  operation: 'search' | 'open-search'; documentId: string; query: string
} {
  return hasExactKeys(message, ['channel', 'version', 'type', 'requestId', 'operation', 'documentId', 'query']) &&
    message.channel === bridgeChannel && message.version === 2 && message.type === 'search-request' &&
    typeof message.requestId === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(message.requestId) &&
    ['search', 'open-search'].includes(String(message.operation)) &&
    typeof message.documentId === 'string' && (message.operation === 'search'
      ? message.documentId === '' : /^[a-zA-Z0-9_.:-]{1,160}$/.test(message.documentId)) &&
    typeof message.query === 'string' && message.query.length <= 150 && !/[\u0000-\u001f\u007f]/.test(message.query)
}

function validDocumentRequest(message: unknown): message is {
  channel: string; version: number; type: string; requestId: string
  operation: 'catalog' | 'link' | 'unlink' | 'open' | 'open-map'
  documentId: string; node: Omit<MapLink, 'documentId'> | null
} {
  if (!hasExactKeys(message, ['channel', 'version', 'type', 'requestId', 'operation', 'documentId', 'node']) ||
    message.channel !== bridgeChannel || message.version !== 2 || message.type !== 'document-request' ||
    typeof message.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(message.requestId) ||
    !['catalog', 'link', 'unlink', 'open', 'open-map'].includes(String(message.operation)) ||
    typeof message.documentId !== 'string' ||
    (message.operation === 'catalog' ? message.documentId !== '' : !/^[a-zA-Z0-9_.:-]{1,160}$/.test(message.documentId))) return false
  if (message.operation === 'link' || message.operation === 'unlink') {
    return hasExactKeys(message.node, ['fieldId', 'categoryId', 'term']) &&
      typeof message.node.fieldId === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(message.node.fieldId) &&
      typeof message.node.categoryId === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(message.node.categoryId) &&
      typeof message.node.term === 'string' && !!message.node.term.trim() && message.node.term.length <= 150 &&
      !/[\u0000-\u001f\u007f]/.test(message.node.term)
  }
  return message.node === null
}

async function handleDocumentRequest(message: unknown, searchRevision?: number): Promise<void> {
  if (!validDocumentRequest(message) && !validSearchRequest(message)) return
  try {
    if (!localDatabase || !screenControls) throw new Error('Miestny Grimoár ešte nie je pripravený.')
    if (!validSearchRequest(message) || isSearchQueryReady(message.query)) await refreshMapSources()
    if (cancelledDocuments.has(message.requestId)) throw new Error('Otvorenie bolo zrušené novšou navigáciou.')
    screenControls.refresh()
    if (validSearchRequest(message)) {
      if (searchRevision !== queryRevision) throw new Error('Vyhľadávanie nahradil novší výraz.')
      if (searchRevision !== queryRevision) throw new Error('Vyhľadávanie nahradil novší výraz.')
      const result = screenControls.search(message.query)
      if (message.operation === 'open-search') await screenControls.openDocument(message.documentId, message.query)
      if (message.operation === 'open-search') announceQuery(message.query)
      window.parent.postMessage({
        channel: bridgeChannel, version: 2, type: 'document-response', requestId: message.requestId,
        ok: true, error: '', result,
      }, window.location.origin)
      return
    }
    const state = localDatabase.read()
    const documentId = message.operation === 'open-map'
      ? state.documents.find(item => item.mapDocumentId === message.documentId)?.id
      : message.documentId
    if (message.operation !== 'catalog' && !documentId) throw new Error('Mapový dokument nie je dostupný v tomto prehliadači.')
    if ((message.operation === 'link' || message.operation === 'unlink') && message.node && documentId) {
      await localDatabase.setMapLink({ documentId, ...message.node }, message.operation === 'link')
    }
    if ((message.operation === 'open' || message.operation === 'open-map') && documentId) {
      await screenControls.openDocument(documentId)
    }
    const current = localDatabase.read()
    const links = [...(current.mapLinks ?? []), ...serverTerms.flatMap(term => term.sourceIds.map(documentId =>
      ({documentId,fieldId:term.fieldId,categoryId:term.categoryId,term:term.term})))]
    const linkedIds = new Set(links.map(item => item.documentId))
    const result = {
      documents: current.documents.map(item => ({
        id: item.id, name: item.name, mapDocumentId: item.mapDocumentId ?? null,
      })),
      links,
      terms: serverTerms,
      selectedDocuments: current.documents.filter(item => linkedIds.has(item.id) && item.mapDocumentId === undefined)
        .map(item => ({
          id: item.id, name: item.name, mime: item.mediaType, size: item.size,
          text: current.textSegments.filter(segment => segment.sourceId === item.id).map(segment => segment.text).join('\n\n'),
          pages: current.textSegments.filter(segment => segment.sourceId === item.id)
            .map((segment, index) => ({ number: segment.pageNumber ?? index + 1, text: segment.text })),
        })),
      documentId: documentId ?? null,
      errors: mapSourceErrors,
    }
    window.parent.postMessage({
      channel: bridgeChannel, version: 2, type: 'document-response', requestId: message.requestId,
      ok: true, error: '', result,
    }, window.location.origin)
  } catch (error) {
    window.parent.postMessage({
      channel: bridgeChannel, version: 2, type: 'document-response', requestId: message.requestId,
      ok: false, error: error instanceof Error ? error.message : 'Prepojenie dokumentu zlyhalo.', result: null,
    }, window.location.origin)
  } finally { cancelledDocuments.delete(message.requestId) }
}

function hasExactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|')
}

function announceBridgeReady(): void {
  if (window.parent !== window) {
    window.parent.postMessage({ channel: bridgeChannel, version: 1, type: 'ready' }, window.location.origin)
  }
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (window.parent === window || event.origin !== window.location.origin || event.source !== window.parent) return
  const message = event.data
  if (validLegacyRequest(message)) {
    documentRequests = documentRequests.then(() => handleLegacyRequest(message))
    return
  }
  if (hasExactKeys(message, ['channel', 'version', 'type', 'requestId']) &&
    message.channel === bridgeChannel && message.version === 2 && message.type === 'document-cancel' &&
    typeof message.requestId === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(message.requestId)) {
    cancelledDocuments.add(message.requestId)
    screenControls?.cancelPendingOpen()
    return
  }
  if (validDocumentRequest(message) || validSearchRequest(message)) {
    const revision = validSearchRequest(message) ? setActiveQuery(message.query) : undefined
    documentRequests = documentRequests.then(() => handleDocumentRequest(message, revision))
    return
  }
  if (!hasExactKeys(message, ['channel', 'version', 'type', 'query'])
    || message.channel !== bridgeChannel || message.version !== 1 || message.type !== 'search'
    || typeof message.query !== 'string' || !message.query.trim() || message.query !== message.query.trim()
    || message.query.length > 150 || /[\u0000-\u001f\u007f]/.test(message.query)) return
  const input = appRoot.querySelector<HTMLInputElement>('#search-query')
  if (!input) return
  input.value = message.query
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.focus({ preventScroll: true })
})

function startTemporaryGrimoire(): void {
  mountSearchScreen(appRoot, new InMemorySourceStore(), new InMemoryGrimoireStore(), { temporary: true })
  announceBridgeReady()
}

function mountLocalGrimoire(database: LocalGrimoireDatabase): void {
  mountSearchScreen(appRoot, new LocalTextDocumentStore(database), new LocalGrimoireStore(database, mapStore), {
    accountEmail: 'Miestny účet hry',
    readingReward: window.parent === window ? undefined : {
      status: () => readingRequest('status'),
      turn: event => readingRequest('turn',event),
    },
    readingPositionStore: new LocalReadingPositionStore(database),
    editedTextStore: new LocalEditedTextStore(database),
    readingMarkerStore: new LocalReadingMarkerStore(database),
    mapNodes: () => mapNodes,
    sourceErrors: () => mapSourceErrors,
    onQueryChange: query => {
      const revision = setActiveQuery(query)
      announceQuery(query)
      window.clearTimeout(queryTimer)
      if (!isSearchQueryReady(query)) return
      queryTimer = window.setTimeout(() => {
        void (async () => {
          try {
            await refreshMapSources()
            if (revision === queryRevision) screenControls?.search(query)
          } catch (error) {
            if (revision !== queryRevision) return
            mapSourceErrors = [`Mapa stromu: ${error instanceof Error ? error.message : 'Vyhľadávanie zlyhalo.'}`]
            screenControls?.search(query)
          }
        })()
      }, 180)
    },
    onMapNode: node => {
      if (window.parent !== window) window.parent.postMessage({
        channel: bridgeChannel, version: 2, type: 'open-map-node',
        node: { fieldId: node.fieldId, categoryId: node.categoryId, term: node.term },
      }, window.location.origin)
    },
    onReady: controls => { screenControls = controls },
  })
  announceBridgeReady()
}

async function startApplication(): Promise<void> {
  appRoot.innerHTML = '<main class="auth-shell"><p class="auth-loading" role="status">Pripájam Grimoár k účtu hry…</p></main>'
  try {
    const api = await LocalGrimoireApi.connect()
    const database = await LocalGrimoireDatabase.load(api)
    mapStore = window.MOKnowledgeStore
    localDatabase = database
    await refreshMapSources()
    mountLocalGrimoire(database)
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Nepodarilo sa načítať miestny Grimoár.'
    showStartupError(appRoot, detail, startTemporaryGrimoire)
  }
}

void startApplication()
