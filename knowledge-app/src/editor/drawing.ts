import { validateDrawing, type Drawing, type Shape, type Point } from './document'

const ns = 'http://www.w3.org/2000/svg'
export function drawingElement(drawing: Drawing): SVGSVGElement {
  validateDrawing(drawing)
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 800 500')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', 'Vložená kresba')
  const defs = document.createElementNS(ns, 'defs')
  svg.append(defs)
  const group = document.createElementNS(ns, 'g')
  svg.append(group)
  const background = document.createElementNS(ns, 'rect')
  background.setAttribute('width', '800')
  background.setAttribute('height', '500')
  background.setAttribute('fill', drawing.background)
  group.append(background)
  const layer: SVGGElement = group
  drawing.shapes.forEach((shape, index) => {
    const [a, b = a] = [shape.points[0], shape.points.at(-1)]
    const dot = ['pen', 'eraser'].includes(shape.tool) && shape.points.length === 1
    const node = document.createElementNS(ns, dot ? 'circle' : shape.tool === 'rectangle' ? 'rect' : shape.tool === 'ellipse' ? 'ellipse' : 'polyline')
    if (dot) {
      node.setAttribute('cx', String(a[0])); node.setAttribute('cy', String(a[1]))
      node.setAttribute('r', String(shape.width / 2))
    } else if (shape.tool === 'rectangle') {
      node.setAttribute('x', String(Math.min(a[0], b[0]))); node.setAttribute('y', String(Math.min(a[1], b[1])))
      node.setAttribute('width', String(Math.abs(b[0] - a[0]))); node.setAttribute('height', String(Math.abs(b[1] - a[1])))
    } else if (shape.tool === 'ellipse') {
      node.setAttribute('cx', String((a[0] + b[0]) / 2)); node.setAttribute('cy', String((a[1] + b[1]) / 2))
      node.setAttribute('rx', String(Math.abs(b[0] - a[0]) / 2)); node.setAttribute('ry', String(Math.abs(b[1] - a[1]) / 2))
    } else {
      const points = shape.tool === 'line' ? [a, b] : shape.points
      node.setAttribute('points', points.map(p => p.join(',')).join(' '))
    }
    node.setAttribute('fill', dot ? (shape.tool === 'eraser' ? '#000000' : shape.color) : 'none'); node.setAttribute('stroke', shape.tool === 'eraser' ? '#000000' : shape.color)
    if (dot) node.setAttribute('stroke', 'none')
    node.setAttribute('stroke-width', String(shape.width)); node.setAttribute('stroke-linecap', 'round'); node.setAttribute('stroke-linejoin', 'round')
    if (shape.tool === 'eraser') {
      // A mask erases previous ink without painting over the paper or future strokes.
      const id = `erase-${crypto.randomUUID()}-${index}`
      const mask = document.createElementNS(ns, 'mask'); mask.id = id
      mask.setAttribute('maskUnits', 'userSpaceOnUse'); mask.setAttribute('x', '0'); mask.setAttribute('y', '0')
      mask.setAttribute('width', '800'); mask.setAttribute('height', '500')
      const white = document.createElementNS(ns, 'rect')
      white.setAttribute('width', '800'); white.setAttribute('height', '500'); white.setAttribute('fill', 'white')
      mask.append(white, node); defs.append(mask)
      const previous = document.createElementNS(ns, 'g')
      while (layer.firstChild && layer.firstChild !== background) previous.append(layer.firstChild)
      if (layer === group) {
        while (background.nextSibling) previous.append(background.nextSibling)
      }
      previous.setAttribute('mask', `url(#${id})`); layer.append(previous)
    } else layer.append(node)
  })
  return svg
}

export class DrawingPad {
  readonly element = document.createElement('section')
  readonly controls = document.createElement('div')
  private drawing: Drawing = { background: '#000000', shapes: [] }
  private undo: Drawing[] = []
  private redo: Drawing[] = []
  private active?: Shape
  private pointer?: number
  constructor(insert: (type: 'drawing' | 'sticky', attrs: Record<string, unknown>) => void) {
    this.element.className = 'drawing-panel'
    this.element.innerHTML = `<h5>Kreslenie a farebné lístky</h5>
      <p>Ťahajte na papieri myšou, perom alebo dotykom. Vloženie použije posledný textový kurzor.</p>
      <div class="rich-tools">
      <label>Nástroj<select aria-label="Nástroj kreslenia"><option value="pen">Pero</option><option value="eraser">Guma</option><option value="line">Čiara</option><option value="rectangle">Obdĺžnik</option><option value="ellipse">Elipsa</option></select></label>
      <label>Farba pera<input type="color" value="#ffffff" aria-label="Farba pera"></label>
      <label>Hrúbka<input type="range" min="1" max="40" value="2" aria-label="Hrúbka čiary"></label>
      <label>Farba papiera<input type="color" value="#000000" aria-label="Farba papiera"></label></div>
      <div class="drawing-paper" tabindex="0" role="group" aria-label="Papier na kreslenie"></div>
      <div class="rich-tools"><button type="button" data-action="undo">Späť kresbu</button><button type="button" data-action="redo">Znova kresbu</button><button type="button" data-action="clear">Vyčistiť papier</button><button type="button" data-action="insert">Vložiť kresbu do textu</button></div>
      <label>Text farebného lístka<textarea maxlength="2000" rows="4" aria-label="Text farebného lístka"></textarea></label>
      <button type="button" data-action="note">Vložiť lístok do textu</button><p class="drawing-status" role="status"></p>`
    const paper = this.element.querySelector<HTMLElement>('.drawing-paper')!
    this.controls.className = 'drawing-controls'
    for (const child of Array.from(this.element.children)) {
      if (child !== paper) this.controls.append(child)
    }
    this.element.prepend(this.controls)
    const tool = this.controls.querySelector('select')!
    const colors = this.controls.querySelectorAll<HTMLInputElement>('input[type=color]')
    const width = this.controls.querySelector<HTMLInputElement>('input[type=range]')!
    const status = this.controls.querySelector<HTMLElement>('.drawing-status')!
    const render = () => {
      paper.replaceChildren(drawingElement(this.active ? { ...this.drawing, shapes: [...this.drawing.shapes, this.active] } : this.drawing))
      this.controls.querySelector<HTMLButtonElement>('[data-action=undo]')!.disabled = !this.undo.length
      this.controls.querySelector<HTMLButtonElement>('[data-action=redo]')!.disabled = !this.redo.length
    }
    const remember = () => { this.undo.push(structuredClone(this.drawing)); if (this.undo.length > 30) this.undo.shift(); this.redo = [] }
    const point = (e: PointerEvent): Point => {
      const r = paper.getBoundingClientRect()
      return [Math.max(0, Math.min(800, (e.clientX - r.left) * 800 / r.width)), Math.max(0, Math.min(500, (e.clientY - r.top) * 500 / r.height))]
    }
    paper.addEventListener('pointerdown', e => {
      if (this.pointer !== undefined || e.button !== 0) return
      if (this.drawing.shapes.length >= 500 || this.drawing.shapes.reduce((n, s) => n + s.points.length, 0) >= 16000) { status.textContent = 'Papier je plný. Vložte kresbu a vyčistite papier.'; return }
      this.pointer = e.pointerId; paper.setPointerCapture(e.pointerId)
      this.active = { tool: tool.value as Shape['tool'], color: colors[0].value, width: Number(width.value), points: [point(e)] }
      render(); e.preventDefault()
    })
    paper.addEventListener('pointermove', e => {
      if (e.pointerId !== this.pointer || !this.active) return
      if (['pen', 'eraser'].includes(this.active.tool)) { if (this.active.points.length < 4000) this.active.points.push(point(e)) }
      else this.active.points = [this.active.points[0], point(e)]
      render()
    })
    paper.addEventListener('pointerup', e => {
      if (e.pointerId !== this.pointer || !this.active) return
      if (!['pen', 'eraser'].includes(this.active.tool)) this.active.points = [this.active.points[0], point(e)]
      remember(); this.drawing.shapes.push(this.active); this.active = undefined; this.pointer = undefined; render()
    })
    const cancel = () => { this.active = undefined; this.pointer = undefined; render() }
    paper.addEventListener('pointercancel', cancel)
    paper.addEventListener('lostpointercapture', cancel)
    paper.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) {
        e.preventDefault(); this.controls.querySelector<HTMLButtonElement>(`[data-action=${e.key.toLowerCase() === 'y' || e.shiftKey ? 'redo' : 'undo'}]`)!.click()
      }
    })
    colors[1].addEventListener('change', () => { remember(); this.drawing.background = colors[1].value; render() })
    this.controls.addEventListener('click', e => {
      const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action
      if (action === 'undo' && this.undo.length) { this.redo.push(this.drawing); this.drawing = this.undo.pop()! }
      if (action === 'redo' && this.redo.length) { this.undo.push(this.drawing); this.drawing = this.redo.pop()! }
      if (action === 'clear') { remember(); this.drawing = { background: this.drawing.background, shapes: [] } }
      if (action === 'insert') insert('drawing', { drawing: structuredClone(this.drawing) })
      if (action === 'note') {
        const text = this.controls.querySelector('textarea')!.value
        if (!text.trim()) { status.textContent = 'Najprv napíšte text lístka.'; return }
        insert('sticky', { background: this.drawing.background, text })
      }
      colors[1].value = this.drawing.background; render()
    })
    render()
  }
}
