import type { JSONContent } from '@tiptap/core'

export const RICH_PREFIX = '\u001eGRIMOIRE:1\n'
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
export type Point = [number, number]
export interface Shape {
  tool: 'pen' | 'eraser' | 'line' | 'rectangle' | 'ellipse'
  color: string
  width: number
  points: Point[]
}
export interface Drawing { background: string; shapes: Shape[] }
export const colorValid = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
function fail(): never { throw new Error('Neplatný alebo príliš veľký obsah editora.') }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

export function validateDrawing(value: unknown): asserts value is Drawing {
  if (!object(value) || !colorValid(value.background) || !Array.isArray(value.shapes) || value.shapes.length > 500) fail()
  let points = 0
  for (const shape of value.shapes as unknown[]) {
    if (!object(shape) || !['pen', 'eraser', 'line', 'rectangle', 'ellipse'].includes(String(shape.tool)) ||
      !colorValid(shape.color) || typeof shape.width !== 'number' || !Number.isFinite(shape.width) || shape.width < 1 || shape.width > 40 ||
      !Array.isArray(shape.points) || shape.points.length < 1 || shape.points.length > 4000) fail()
    for (const point of shape.points as unknown[]) {
      if (!Array.isArray(point) || point.length !== 2 || point.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 800)) fail()
      points++
    }
  }
  if (points > 20000) fail()
}

export function validateDocument(doc: unknown): asserts doc is JSONContent {
  if (new TextEncoder().encode(JSON.stringify(doc)).length > MAX_DOCUMENT_BYTES) fail()
  let count = 0
  const walk = (node: unknown, depth: number): void => {
    if (!object(node) || depth > 20 || ++count > 100000 ||
      !['doc', 'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'text', 'hardBreak', 'drawing', 'sticky'].includes(String(node.type))) fail()
    if (node.text !== undefined && (node.type !== 'text' || typeof node.text !== 'string' || !node.text)) fail()
    if (node.type === 'text' && typeof node.text !== 'string') fail()
    if (node.attrs !== undefined) {
      if (!object(node.attrs)) fail()
      for (const [key, value] of Object.entries(node.attrs)) {
        if (value === null) continue
        if (key === 'textAlign' && ['left', 'center', 'right', 'justify'].includes(String(value))) continue
        if (key === 'level' && [1, 2, 3].includes(Number(value))) continue
        if (key === 'start' && Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 100000) continue
        if (key === 'background' && colorValid(value)) continue
        if (key === 'text' && node.type === 'sticky' && typeof value === 'string' && value.length <= 2000) continue
        if (key === 'drawing' && node.type === 'drawing') { validateDrawing(value); continue }
        fail()
      }
    }
    if (node.type === 'drawing') validateDrawing((node.attrs as Record<string, unknown>)?.drawing)
    if (node.type === 'sticky' && (!object(node.attrs) || !colorValid(node.attrs.background) || typeof node.attrs.text !== 'string' || node.attrs.text.length > 2000)) fail()
    if (node.marks !== undefined) {
      if (!Array.isArray(node.marks) || node.marks.length > 5) fail()
      for (const mark of node.marks) {
        if (!object(mark) || !['bold', 'italic', 'underline', 'textStyle', 'highlight'].includes(String(mark.type))) fail()
        if (mark.attrs !== undefined) {
          if (!object(mark.attrs)) fail()
          for (const [key, value] of Object.entries(mark.attrs)) {
            if (value === null) continue
            if (key === 'color' && colorValid(value)) continue
            if (key === 'fontSize' && typeof value === 'string' && /^(10|12|14|16|18|24|32|48)px$/.test(value)) continue
            fail()
          }
        }
      }
    }
    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) fail()
      node.content.forEach(child => walk(child, depth + 1))
    }
  }
  if (!object(doc) || doc.type !== 'doc') fail()
  walk(doc, 0)
}

export function plainDocument(text: string): JSONContent {
  return { type: 'doc', content: text.split('\n').map(line => ({ type: 'paragraph', ...(line ? { content: [{ type: 'text', text: line }] } : {}) })) }
}
export function decodeDocument(value: string): JSONContent {
  const doc: unknown = value.startsWith(RICH_PREFIX) ? JSON.parse(value.slice(RICH_PREFIX.length)) : plainDocument(value)
  validateDocument(doc)
  return doc
}
export function encodeDocument(doc: JSONContent): string {
  validateDocument(doc)
  return RICH_PREFIX + JSON.stringify(doc)
}
export function documentText(doc: JSONContent): string {
  if (doc.type === 'text') return doc.text ?? ''
  if (doc.type === 'sticky') return String(doc.attrs?.text ?? '')
  if (doc.type === 'drawing') return '[Kresba]'
  if (doc.type === 'hardBreak') return '\n'
  return (doc.content ?? []).map(documentText).join(['doc', 'bulletList', 'orderedList', 'listItem'].includes(doc.type ?? '') ? '\n' : '')
}
