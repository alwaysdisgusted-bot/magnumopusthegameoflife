import type { Source, TextSegment } from '../sources/models'

export interface SourcePage {
  pageNumber: number
  text: string
}

export interface SourceStore {
  listSources(): Source[]
  listTextSegments(): TextSegment[]
}

export interface TextDocumentStore extends SourceStore {
  addTextDocument(source: Source, text: string, pages?: readonly SourcePage[]): void | Promise<void>
  getText(sourceId: string): string | undefined
  getTextSegments(sourceId: string): TextSegment[]
  forgetDocuments(sourceIds: readonly string[]): void
}

export class InMemorySourceStore implements TextDocumentStore {
  private readonly sources: Source[] = []
  private readonly segments: TextSegment[] = []
  private readonly textBySourceId = new Map<string, string>()

  listSources(): Source[] {
    return [...this.sources]
  }

  listTextSegments(): TextSegment[] {
    return [...this.segments]
  }

  addTextDocument(source: Source, text: string, pages?: readonly SourcePage[]): void {
    if (this.sources.some((existingSource) => existingSource.id === source.id)) {
      throw new Error(`Zdroj „${source.title}“ už bol pridaný.`)
    }

    this.sources.push({ ...source })
    this.segments.push(...(pages?.length
      ? pages.map(({ pageNumber, text: pageText }) => ({
        id: `${source.id}:page:${pageNumber}`,
        sourceId: source.id,
        text: pageText,
        pageNumber,
      }))
      : [{
        id: `${source.id}:text`,
        sourceId: source.id,
        text,
      }]))
    this.textBySourceId.set(source.id, text)
  }

  getText(sourceId: string): string | undefined {
    return this.textBySourceId.get(sourceId)
  }

  forgetDocuments(sourceIds: readonly string[]): void {
    const ids = new Set(sourceIds)
    for (let i = this.sources.length - 1; i >= 0; i--) {
      if (ids.has(this.sources[i].id)) this.sources.splice(i, 1)
    }
    for (let i = this.segments.length - 1; i >= 0; i--) {
      if (ids.has(this.segments[i].sourceId)) this.segments.splice(i, 1)
    }
    for (const id of ids) this.textBySourceId.delete(id)
  }

  getTextSegments(sourceId: string): TextSegment[] {
    return this.segments.filter((segment) => segment.sourceId === sourceId)
  }
}
