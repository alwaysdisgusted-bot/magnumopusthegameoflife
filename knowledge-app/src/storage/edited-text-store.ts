import { decodeDocument, RICH_PREFIX } from '../editor/document'

export const MAX_EDITED_TEXT_BYTES = 10 * 1024 * 1024

export interface EditedTextStore {
  get(documentId: string): Promise<string | undefined>
  save(documentId: string, text: string): Promise<void>
}

export function validateEditedText(text: string): void {
  if (new TextEncoder().encode(text.startsWith(RICH_PREFIX) ? text.slice(RICH_PREFIX.length) : text).byteLength > MAX_EDITED_TEXT_BYTES) {
    throw new Error('Upravený text je väčší než 10 MiB. Skráťte ho alebo ho uložte po menších častiach.')
  }
  if (text.startsWith(RICH_PREFIX)) decodeDocument(text)
}

export class InMemoryEditedTextStore implements EditedTextStore {
  private readonly texts = new Map<string, string>()

  async get(documentId: string): Promise<string | undefined> {
    return this.texts.get(documentId)
  }

  async save(documentId: string, text: string): Promise<void> {
    validateEditedText(text)
    this.texts.set(documentId, text)
  }
}
