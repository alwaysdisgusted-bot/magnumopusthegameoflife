export interface Source {
  id: string
  title: string
  kind: 'text' | 'document'
  createdAt: string
}

export interface TextSegment {
  id: string
  sourceId: string
  text: string
  pageNumber?: number
}

export interface SearchOccurrence {
  segmentId: string
  sourceId: string
  startOffset: number
  endOffset: number
  pageNumber?: number
}

export interface SearchResult {
  id: string
  sourceId: string
  sourceTitle: string
  sourceHref: string
  excerpt: string
  occurrence: SearchOccurrence
}
