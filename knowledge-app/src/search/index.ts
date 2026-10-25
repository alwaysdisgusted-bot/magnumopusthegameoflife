import type { SearchResult, Source, TextSegment } from '../sources/models'
import { normalizedTextWithOffsets } from './text-normalization'

interface IndexedSegment extends TextSegment {
  normalizedText: string
  originalOffsets: Array<{ start: number; end: number }>
}

export function exactTextRanges(text: string, query: string): Array<{ start: number; end: number }> {
  return searchIndex(buildSearchIndex([{ id: 'text', sourceId: 'text', text }]), query, [
    { id: 'text', title: '', kind: 'document', createdAt: '' },
  ]).map(result => ({ start: result.occurrence.startOffset, end: result.occurrence.endOffset }))
}

export function buildSearchIndex(segments: readonly TextSegment[]): IndexedSegment[] {
  return segments.map((segment) => {
    const normalized = normalizedTextWithOffsets(segment.text)

    return {
      ...segment,
      normalizedText: normalized.text,
      originalOffsets: normalized.originalOffsets,
    }
  })
}

export function searchIndex(
  index: readonly IndexedSegment[],
  query: string,
  sources: readonly Source[],
): SearchResult[] {
  const normalizedQuery = normalizedTextWithOffsets(query.trim()).text

  if (!normalizedQuery) {
    return []
  }

  const sourcesById = new Map(sources.map((source) => [source.id, source]))

  const results = new Map<string, SearchResult>()

  for (const segment of index) {
    const source = sourcesById.get(segment.sourceId)

    if (!source) {
      continue
    }

    let exactMatchOffset = segment.normalizedText.indexOf(normalizedQuery)
    while (exactMatchOffset !== -1) {
      const firstOffset = segment.originalOffsets[exactMatchOffset]
      const lastOffset = segment.originalOffsets[exactMatchOffset + normalizedQuery.length - 1]

      if (firstOffset && lastOffset) {
        addResult(results, source, segment, firstOffset.start, lastOffset.end)
      }
      exactMatchOffset = segment.normalizedText.indexOf(normalizedQuery, exactMatchOffset + 1)
    }

  }

  return [...results.values()]
}

function addResult(
  results: Map<string, SearchResult>,
  source: Source,
  segment: IndexedSegment,
  startOffset: number,
  endOffset: number,
): void {
  const id = `${source.id}:${segment.id}:${startOffset}`

  const excerptStart = Math.max(0, startOffset - 60)
  const excerptEnd = Math.min(segment.text.length, endOffset + 60)
  const excerpt = [
    excerptStart > 0 ? '…' : '',
    segment.text.slice(excerptStart, excerptEnd),
    excerptEnd < segment.text.length ? '…' : '',
  ].join('')

  results.set(id, {
    id,
    sourceId: source.id,
    sourceTitle: source.title,
    sourceHref: `/sources/${encodeURIComponent(source.id)}`,
    excerpt,
    occurrence: {
      segmentId: segment.id,
      sourceId: source.id,
      startOffset,
      endOffset,
      ...(segment.pageNumber === undefined ? {} : { pageNumber: segment.pageNumber }),
    },
  })
}
