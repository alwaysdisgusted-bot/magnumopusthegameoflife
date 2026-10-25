import { validateNote, type FavoriteWord } from './favorite-word-store'

export interface WordCollection {
  id: string
  favoriteId: string
  word: string
  title: string
  note: string
  kind: 'tab' | 'folder'
  parentTabId: string | null
  excludedDocumentIds: string[]
  includedDocumentIds: string[]
  uploadFolderId: string | null
}

export interface WordCollectionStore {
  list(): WordCollection[]
  create(favorite: FavoriteWord, parentTabId: string | null): Promise<WordCollection>
  exclude(collectionId: string, documentId: string): Promise<void>
  include(collectionId: string, documentId: string): Promise<void>
  setUploadFolder(collectionId: string, folderId: string): Promise<void>
  saveDetails(collectionId: string, title: string, note: string): Promise<void>
}

function copy(collection: WordCollection): WordCollection {
  return { ...collection, excludedDocumentIds: [...collection.excludedDocumentIds],
    includedDocumentIds: [...collection.includedDocumentIds] }
}

export class InMemoryWordCollectionStore implements WordCollectionStore {
  protected readonly collections = new Map<string, WordCollection>()

  list(): WordCollection[] { return [...this.collections.values()].map(copy) }

  async create(favorite: FavoriteWord, parentTabId: string | null): Promise<WordCollection> {
    const existing = this.list().find((item) => item.favoriteId === favorite.id && item.parentTabId === parentTabId)
    if (existing) return existing
    const collection: WordCollection = {
      id: crypto.randomUUID(), favoriteId: favorite.id, word: favorite.word,
      title: favorite.word, note: '',
      kind: parentTabId ? 'folder' : 'tab', parentTabId, excludedDocumentIds: [],
      includedDocumentIds: [], uploadFolderId: null,
    }
    this.collections.set(collection.id, collection)
    return copy(collection)
  }

  async exclude(collectionId: string, documentId: string): Promise<void> {
    const collection = this.collections.get(collectionId)
    if (!collection) throw new Error('Slovná kolekcia už nie je dostupná.')
    if (!collection.excludedDocumentIds.includes(documentId)) collection.excludedDocumentIds.push(documentId)
    collection.includedDocumentIds = collection.includedDocumentIds.filter((id) => id !== documentId)
  }

  async include(collectionId: string, documentId: string): Promise<void> {
    const collection = this.collections.get(collectionId)
    if (!collection) throw new Error('Slovná kolekcia už nie je dostupná.')
    if (!collection.includedDocumentIds.includes(documentId)) collection.includedDocumentIds.push(documentId)
    collection.excludedDocumentIds = collection.excludedDocumentIds.filter((id) => id !== documentId)
  }

  async setUploadFolder(collectionId: string, folderId: string): Promise<void> {
    const collection = this.collections.get(collectionId)
    if (!collection) throw new Error('Slovná kolekcia už nie je dostupná.')
    collection.uploadFolderId = folderId
  }

  async saveDetails(collectionId: string, title: string, note: string): Promise<void> {
    const value = validateDetails(title, note)
    const collection = this.collections.get(collectionId)
    if (!collection) throw new Error('Slovná kolekcia už nie je dostupná.')
    collection.title = value
    collection.note = note
  }
}

function validateDetails(title: string, note: string): string {
  const value = title.trim()
  if (!value || value.length > 120) throw new Error('Názov musí mať 1 až 120 znakov.')
  validateNote(note)
  return value
}
