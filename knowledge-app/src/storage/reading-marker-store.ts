export interface ReadingMarker {
  segmentIndex: number
  startOffset: number
  endOffset: number
}

export interface ReadingMarkerStore {
  get(documentId: string): Promise<ReadingMarker | undefined>
  set(documentId: string, marker: ReadingMarker | undefined): Promise<void>
}

function validateMarker(marker: ReadingMarker): void {
  if (![marker.segmentIndex, marker.startOffset, marker.endOffset].every(Number.isSafeInteger) ||
    marker.segmentIndex < 0 || marker.startOffset < 0 || marker.endOffset <= marker.startOffset) {
    throw new Error('Značka čítania má neplatnú polohu.')
  }
}

export class InMemoryReadingMarkerStore implements ReadingMarkerStore {
  private readonly markers = new Map<string, ReadingMarker>()

  async get(documentId: string): Promise<ReadingMarker | undefined> {
    const marker = this.markers.get(documentId)
    return marker ? { ...marker } : undefined
  }

  async set(documentId: string, marker: ReadingMarker | undefined): Promise<void> {
    if (marker) {
      validateMarker(marker)
      this.markers.set(documentId, { ...marker })
    } else {
      this.markers.delete(documentId)
    }
  }
}
