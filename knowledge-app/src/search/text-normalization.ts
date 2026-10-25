interface NormalizedText {
  text: string
  originalOffsets: Array<{ start: number; end: number }>
}

export function normalizedTextWithOffsets(text: string): NormalizedText {
  const normalizedParts: string[] = []
  const originalOffsets: Array<{ start: number; end: number }> = []
  let originalOffset = 0

  for (const originalCharacter of text) {
    const start = originalOffset
    originalOffset += originalCharacter.length
    const normalizedCharacter = originalCharacter.toLowerCase().normalize('NFD')
    if (/^\p{M}+$/u.test(originalCharacter)) {
      const previous = originalOffsets.at(-1)
      if (previous) previous.end = originalOffset
      continue
    }
    for (const character of normalizedCharacter) {
      if (/\p{M}/u.test(character)) continue
      normalizedParts.push(character)
      for (let index = 0; index < character.length; index += 1) {
        originalOffsets.push({ start, end: originalOffset })
      }
    }
  }
  return { text: normalizedParts.join(''), originalOffsets }
}
