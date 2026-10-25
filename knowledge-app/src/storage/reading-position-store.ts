export interface ReadingPosition {
  pageIndex: number
  scrollFraction: number
}

export interface ReadingPositionStore {
  get(documentId: string): ReadingPosition | undefined
  save(documentId: string, position: ReadingPosition): Promise<void>
}

export class InMemoryReadingPositionStore implements ReadingPositionStore {
  protected readonly positions = new Map<string, ReadingPosition>()

  get(documentId: string): ReadingPosition | undefined {
    const position = this.positions.get(documentId)
    return position ? { ...position } : undefined
  }

  async save(documentId: string, position: ReadingPosition): Promise<void> {
    this.positions.set(documentId, { ...position })
  }
}
