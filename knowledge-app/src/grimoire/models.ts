export interface GrimoireTab {
  id: string
  title: string
}

export interface GrimoireFolder {
  id: string
  tabId: string
  parentId: string | null
  title: string
  note: string
  linkedDocumentIds?: string[]
}

export interface GrimoireDocument {
  id: string
  folderId: string
  name: string
  mediaType: string
  size: number
  addedAt: string
  file?: File
  storagePath?: string
}

export interface GrimoireDestination {
  id: string
  title: string
  kind: 'tab' | 'folder'
  tabId: string
  parentId: string | null
}
