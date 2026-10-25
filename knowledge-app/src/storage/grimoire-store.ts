import type { GrimoireDocument, GrimoireFolder, GrimoireTab } from '../grimoire/models'
import { isSupportedDocument } from '../grimoire/documents'
import { validateNote } from './favorite-word-store'

export type MaybePromise<T> = T | Promise<T>

export interface GrimoireStore {
  listTabs(): GrimoireTab[]
  listFolders(tabId: string): GrimoireFolder[]
  listDocuments(folderId: string): GrimoireDocument[]
  createTab(title: string): MaybePromise<GrimoireTab>
  createFolder(tabId: string, parentId: string | null, title: string): MaybePromise<GrimoireFolder>
  renameTab(tabId: string, title: string): MaybePromise<void>
  renameFolder(folderId: string, title: string): MaybePromise<void>
  saveFolderDetails(folderId: string, title: string, note: string): MaybePromise<void>
  deleteFolder(folderId: string, expectedDocumentIds?: readonly string[]): MaybePromise<void>
  mergeFolders(sourceId: string, targetId: string): MaybePromise<void>
  addDocument(folderId: string, file: File): MaybePromise<GrimoireDocument>
  removeDocument(documentId: string): MaybePromise<void>
  downloadDocument(documentId: string): Promise<Blob>
}

export class InMemoryGrimoireStore implements GrimoireStore {
  private readonly tabs: GrimoireTab[] = []
  private readonly folders: GrimoireFolder[] = []
  private readonly documents: GrimoireDocument[] = []

  listTabs(): GrimoireTab[] {
    return [...this.tabs]
  }

  listFolders(tabId: string): GrimoireFolder[] {
    return this.folders.filter((folder) => folder.tabId === tabId)
  }

  listDocuments(folderId: string): GrimoireDocument[] {
    return this.documents.filter((document) => document.folderId === folderId)
  }

  createTab(title: string): GrimoireTab {
    const tab = { id: crypto.randomUUID(), title: requireTitle(title) }
    this.tabs.push(tab)
    return tab
  }

  createFolder(tabId: string, parentId: string | null, title: string): GrimoireFolder {
    if (!this.tabs.some((tab) => tab.id === tabId)) {
      throw new Error('Vybraná záložka neexistuje.')
    }
    if (parentId && !this.folders.some((folder) => folder.id === parentId && folder.tabId === tabId)) {
      throw new Error('Nadradený priečinok neexistuje.')
    }

    const folder = {
      id: crypto.randomUUID(),
      tabId,
      parentId,
      title: requireTitle(title),
      note: '',
    }
    this.folders.push(folder)
    return folder
  }

  addDocument(folderId: string, file: File): GrimoireDocument {
    if (!this.folders.some((folder) => folder.id === folderId)) {
      throw new Error('Vybraný priečinok neexistuje.')
    }
    if (!isSupportedDocument(file.name)) {
      throw new Error(`Formát súboru „${file.name}“ nie je podporovaný.`)
    }

    const document: GrimoireDocument = {
      id: crypto.randomUUID(),
      folderId,
      name: file.name,
      mediaType: file.type,
      size: file.size,
      addedAt: new Date().toISOString(),
      file,
    }
    this.documents.push(document)
    return document
  }

  renameTab(tabId: string, title: string): void {
    const tab = this.tabs.find((item) => item.id === tabId)
    if (!tab) throw new Error('Záložka neexistuje.')
    tab.title = requireTitle(title)
  }

  renameFolder(folderId: string, title: string): void {
    const folder = this.folders.find((item) => item.id === folderId)
    if (!folder) throw new Error('Priečinok neexistuje.')
    folder.title = requireTitle(title)
  }

  saveFolderDetails(folderId: string, title: string, note: string): void {
    const value = requireTitle(title)
    validateNote(note)
    const folder = this.folders.find((item) => item.id === folderId)
    if (!folder) throw new Error('Priečinok neexistuje.')
    folder.title = value
    folder.note = note
  }

  deleteFolder(folderId: string, expectedDocumentIds?: readonly string[]): void {
    if (!this.folders.some((folder) => folder.id === folderId)) throw new Error('Priečinok neexistuje.')
    const ids = folderSubtreeIds(this.folders, folderId)
    const documents = this.documents.filter((document) => ids.has(document.folderId))
    if (expectedDocumentIds && (documents.length !== expectedDocumentIds.length ||
      documents.some((document) => !expectedDocumentIds.includes(document.id)))) {
      throw new Error('Obsah priečinka sa zmenil. Zavrite ponuku a potvrďte aktuálny obsah znova.')
    }
    for (let i = this.documents.length - 1; i >= 0; i--) {
      if (ids.has(this.documents[i].folderId)) this.documents.splice(i, 1)
    }
    for (let i = this.folders.length - 1; i >= 0; i--) {
      if (ids.has(this.folders[i].id)) this.folders.splice(i, 1)
    }
  }

  mergeFolders(sourceId: string, targetId: string): void {
    const source = this.folders.find((folder) => folder.id === sourceId)
    const target = this.folders.find((folder) => folder.id === targetId)
    if (!source || !target || source.tabId !== target.tabId ||
      folderSubtreeIds(this.folders, sourceId).has(targetId)) {
      throw new Error('Zvoľte iný priečinok v rovnakej záložke, nie jeho podpriečinok.')
    }
    for (const document of this.documents) {
      if (document.folderId === sourceId) document.folderId = targetId
    }
    for (const folder of this.folders) {
      if (folder.parentId === sourceId) folder.parentId = targetId
    }
    this.folders.splice(this.folders.indexOf(source), 1)
  }

  removeDocument(documentId: string): void {
    const index = this.documents.findIndex((item) => item.id === documentId)
    if (index >= 0) this.documents.splice(index, 1)
  }

  async downloadDocument(documentId: string): Promise<Blob> {
    const stored = this.documents.find((item) => item.id === documentId)
    if (!stored?.file) throw new Error('Originálny súbor nie je dostupný.')
    return stored.file
  }
}

function requireTitle(title: string): string {
  const trimmedTitle = title.trim()
  if (!trimmedTitle) {
    throw new Error('Zadajte názov.')
  }
  if (trimmedTitle.length > 80) throw new Error('Názov môže mať najviac 80 znakov.')
  return trimmedTitle
}

export function folderSubtreeIds(folders: readonly GrimoireFolder[], rootId: string): Set<string> {
  const ids = new Set([rootId])
  let size = 0
  while (size !== ids.size) {
    size = ids.size
    for (const folder of folders) {
      if (folder.parentId && ids.has(folder.parentId)) ids.add(folder.id)
    }
  }
  return ids
}
