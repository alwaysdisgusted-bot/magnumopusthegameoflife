import type { GrimoireDestination, GrimoireFolder, GrimoireTab } from '../grimoire/models'
import { exactTextRanges } from './index'
import { isSearchQueryReady } from './search-service'

export function searchDestinations(
  query: string,
  _tabs: readonly GrimoireTab[],
  folders: readonly GrimoireFolder[],
): GrimoireDestination[] {
  if (!isSearchQueryReady(query)) return []
  return [
    ...folders.map((folder) => ({
      id: folder.id, title: folder.title, kind: 'folder' as const,
      tabId: folder.tabId, parentId: folder.parentId,
    })),
  ].filter((destination) => exactTextRanges(destination.title, query).length > 0)
}
