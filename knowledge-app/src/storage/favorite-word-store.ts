import { normalizedTextWithOffsets } from '../search/text-normalization'

export interface FavoriteWord {
  id: string
  word: string
  normalizedWord: string
  note: string
}

export interface FavoriteWordStore {
  list(): Promise<FavoriteWord[]>
  add(word: string): Promise<FavoriteWord>
  saveNote(id: string, note: string): Promise<void>
}

function validateWord(word: string): string {
  const value = word.trim()
  if (!value || value.length > 120) throw new Error('Výraz musí mať 1 až 120 znakov.')
  return value
}

export function validateNote(note: string): void {
  if (note.length > 500) throw new Error('Vlastný text môže mať najviac 500 znakov.')
}

export class InMemoryFavoriteWordStore implements FavoriteWordStore {
  private readonly words: FavoriteWord[] = []

  async list(): Promise<FavoriteWord[]> {
    return this.words.map((word) => ({ ...word }))
  }

  async add(word: string): Promise<FavoriteWord> {
    const value = validateWord(word)
    const normalizedWord = normalizedTextWithOffsets(value).text
    const existing = this.words.find((item) => item.normalizedWord === normalizedWord)
    if (existing) return { ...existing }
    const favorite = { id: crypto.randomUUID(), word: value, normalizedWord, note: '' }
    this.words.push(favorite)
    return { ...favorite }
  }

  async saveNote(id: string, note: string): Promise<void> {
    validateNote(note)
    const favorite = this.words.find((item) => item.id === id)
    if (!favorite) throw new Error('Obľúbený výraz už nie je dostupný.')
    favorite.note = note
  }
}
