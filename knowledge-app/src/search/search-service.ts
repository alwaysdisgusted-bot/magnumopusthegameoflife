import { buildSearchIndex, searchIndex } from './index'
import type { SearchOccurrence, SearchResult, Source } from '../sources/models'
import type { SourceStore } from '../storage/source-store'
import type { GrimoireStore } from '../storage/grimoire-store'

export function isSearchQueryReady(query: string): boolean {
  return (query.normalize('NFC').match(/\p{L}/gu)?.length ?? 0) >= 3
}

export interface MapSearchNode {
  id: string
  fieldId: string
  categoryId: string
  term: string
  title: string
  description: string
}

export interface LibrarySearch {
  query: string
  documents: Array<{
    documentId: string; title: string; excerpt: string; occurrences: number; occurrence?: SearchOccurrence
  }>
  nodes: MapSearchNode[]
  sources: LibrarySourceResult[]
  errors: string[]
}

export interface LibrarySourceResult {
  kind: string; id: string; title: string; snippet: string; url: string
}

export function searchLibrary(
  query: string, sourceStore: SourceStore, _grimoire: GrimoireStore,
  nodes: readonly MapSearchNode[] = [], errors: readonly string[] = [],
  _sources: readonly LibrarySourceResult[] = [],
): LibrarySearch {
  const value = query.trim()
  if (!isSearchQueryReady(value)) return { query: value, documents: [], nodes: [], sources: [], errors: [] }
  const documents = new Map<string, LibrarySearch['documents'][number]>()
  for (const match of searchSources(value, sourceStore)) {
    const existing = documents.get(match.sourceId)
    if (existing) existing.occurrences += 1
    else documents.set(match.sourceId, {
      documentId: match.sourceId, title: match.sourceTitle, excerpt: match.excerpt,
      occurrences: 1, occurrence: match.occurrence,
    })
  }
  const exactMatches = (items: Array<{ id: string; title: string; text: string }>): Set<string> => {
    const sources: Source[] = items.map(item => ({ id: item.id, title: item.title, kind: 'document', createdAt: '' }))
    const index = buildSearchIndex(items.map(item => ({ id: item.id, sourceId: item.id, text: item.text })))
    return new Set(searchIndex(index, value, sources).map(item => item.sourceId))
  }
  const nodeIds = exactMatches(nodes.map(node => ({
    id: node.id, title: node.title, text: [node.term, node.description].join('\n'),
  })))
  return { query: value, documents: [...documents.values()],
    nodes: [...new Map(nodes.filter(node => nodeIds.has(node.id)).map(node => [node.id, node])).values()],
    sources: [],
    errors: [...errors] }
}

export function searchSources(query: string, sourceStore: SourceStore): SearchResult[] {
  const sources = sourceStore.listSources()
  const index = buildSearchIndex(sourceStore.listTextSegments())

  return searchIndex(index, query, sources)
}
