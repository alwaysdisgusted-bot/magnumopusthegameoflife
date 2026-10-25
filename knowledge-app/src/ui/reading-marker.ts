import type { ReadingMarker } from '../storage/reading-marker-store'

export function markerFromSelection(content: HTMLElement, selection: Selection | null): ReadingMarker | undefined {
  if (!selection?.rangeCount) return undefined
  const range = selection.getRangeAt(0)
  const start = range.startContainer
  const paragraph = (start instanceof Element ? start : start.parentElement)?.closest<HTMLElement>('[data-segment-index]')
  if (!paragraph || !content.contains(paragraph) || !paragraph.contains(range.endContainer)) return undefined
  const prefix = range.cloneRange()
  prefix.selectNodeContents(paragraph)
  prefix.setEnd(range.startContainer, range.startOffset)
  const offset = prefix.toString().length
  const text = paragraph.textContent ?? ''
  for (const word of text.matchAll(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’\-][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/gu)) {
    const endOffset = word.index + word[0].length
    if (word.index <= offset && offset < endOffset) {
      return { segmentIndex: Number(paragraph.dataset.segmentIndex), startOffset: word.index, endOffset }
    }
  }
  return undefined
}

export function renderReadingMarker(content: HTMLElement, marker: ReadingMarker | undefined): boolean {
  content.querySelectorAll('.reading-marker').forEach((span) => {
    const parent = span.parentNode
    span.replaceWith(...span.childNodes)
    parent?.normalize()
  })
  if (!marker) return true
  const paragraph = content.querySelector<HTMLElement>(`[data-segment-index="${marker.segmentIndex}"]`)
  if (!paragraph || marker.endOffset > (paragraph.textContent?.length ?? 0)) return false
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
  const parts: Array<{ node: Text; start: number; end: number }> = []
  let offset = 0
  let node: Node | null
  while ((node = walker.nextNode())) {
    const length = node.textContent?.length ?? 0
    if (offset < marker.endOffset && offset + length > marker.startOffset && node instanceof Text) {
      parts.push({ node, start: Math.max(0, marker.startOffset - offset), end: Math.min(length, marker.endOffset - offset) })
    }
    offset += length
  }
  for (const part of parts) {
    const range = document.createRange()
    range.setStart(part.node, part.start)
    range.setEnd(part.node, part.end)
    const span = document.createElement('span')
    span.className = 'reading-marker'
    range.surroundContents(span)
  }
  return parts.length > 0
}
