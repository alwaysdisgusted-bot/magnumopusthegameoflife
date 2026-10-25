import type { DrawingPad } from './drawing'
import { RichEditor } from './rich-editor'

type Area = 'desk' | 'workspace'
interface WorkbenchHost {
  attach(area: Area, target: HTMLElement, source: Window, controls?: HTMLElement): void
  detach(area: Area, source: Window): void
  resize(area: Area, width: number, height: number, source: Window): void
  endInteraction(source: Window): void
  tools(value: { color?: string; size?: number; tool?: string } | null, category: string | null, source: Window): void
}
declare global { interface Window { MOGrimoireWorkbench?: WorkbenchHost } }

export class Workbench {
  readonly element = document.createElement('section')
  private readonly panels = new Map<string, { pane: HTMLElement; home: HTMLElement; popup?: Window; restore?: () => void }>()
  private attached = false
  private readonly status: HTMLElement
  private scratch?: RichEditor
  private scratchDirty = false
  private documentPad?: DrawingPad
  private documentControls?: HTMLElement
  private documentEditor?: RichEditor
  private readonly combinedPanel = document.createElement('section')
  private readonly combinedHome = document.createElement('div')
  private category = 'text'
  private sharedColor = '#ffffff'
  private sharedSize = 2
  private sharedTool = 'pen'
  private readonly textTools = document.createElement('div')
  private readonly drawingTools = document.createElement('div')
  private readonly documentActions: HTMLElement
  private readonly scratchActions = document.createElement('div')
  private readonly stage = document.createElement('div')
  private readonly textSurface: HTMLElement
  private readonly canvasSurface: HTMLElement
  private readonly lockButton: HTMLButtonElement
  private textLocked = false
  private readonly warnScratch = (event: BeforeUnloadEvent) => {
    if (this.scratchDirty) { event.preventDefault(); event.returnValue = '' }
  }
  private readonly reset = () => {
    this.restoreAll()
    this.attached = false
    this.textLocked = false
    this.applyTextLock()
  }
  constructor(editorPanel: HTMLElement, private readonly rootChanged: () => void, private readonly lockDocument: (locked: boolean) => void = () => {}) {
    this.element.id = 'grimoire-workbench'
    this.element.className = 'grimoire-workbench'
    this.element.setAttribute('aria-label', 'Editor a kanvas')
    this.element.innerHTML = `<p class="workbench-status" role="status"></p><div class="workbench-split">
      <div data-pane-home="text"><section class="workbench-pane" data-pane="text" aria-label="Textový editor">
        <header class="workbench-toolbar"><h3>Textový editor</h3><div class="workbench-actions"><nav aria-label="Obsah textového editora"><button type="button" data-source="scratch" aria-pressed="true">Nový text</button><button type="button" data-source="document" aria-pressed="false" hidden>Text dokumentu</button></nav><button type="button" data-resize="text">Nastaviť rozhranie</button><button type="button" data-popout="text">Otvoriť editor v okne</button></div></header>
        <div class="workbench-resize"><label>Šírka <input type="number" min="320" max="10000" value="800" data-width="text"> px</label><label>Výška <input type="number" min="240" max="10000" value="720" data-height="text"> px</label></div>
        <div class="workbench-scroll text-surface"><div data-scratch-slot></div><div data-document-slot hidden></div></div>
      </section></div>
      <div data-pane-home="canvas"><section class="workbench-pane" data-pane="canvas" aria-label="Alchymistický stôl a kanvas">
        <header class="workbench-toolbar"><h3>Alchymistický stôl</h3><div class="workbench-actions"><nav aria-label="Obsah kanvasu"><button type="button" data-canvas="desk" aria-pressed="true">Spoločný kanvas</button><button type="button" data-canvas="insert" aria-pressed="false">Kresba a lístok do textu</button></nav><button type="button" data-resize="canvas">Nastaviť rozhranie</button><button type="button" data-popout="canvas">Otvoriť kanvas v okne</button></div><div data-desk-controls></div></header>
        <div class="workbench-resize"><label>Šírka <input type="number" min="320" max="10000" value="5800" data-width="canvas"> px</label><label>Výška <input type="number" min="240" max="10000" value="5800" data-height="canvas"> px</label></div>
        <div class="workbench-scroll"><div data-desk-slot></div><div data-drawing-slot hidden><p>Pre vloženie kresby alebo lístka najprv otvorte upravovanú verziu dokumentu.</p></div></div>
      </section></div></div>`
    this.status = this.element.querySelector('.workbench-status')!
    this.textSurface = this.element.querySelector<HTMLElement>('.text-surface')!
    this.canvasSurface = this.element.querySelector<HTMLElement>('[data-pane="canvas"] > .workbench-scroll')!
    this.stage.className = 'workbench-shared-stage'
    this.stage.append(this.canvasSurface, this.textSurface)
    this.element.querySelector('.workbench-split')!.append(this.stage)
    this.canvasSurface.classList.add('shared-desk-surface')
    this.lockButton = document.createElement('button')
    this.lockButton.type = 'button'
    this.lockButton.dataset.textLock = ''
    this.lockButton.setAttribute('aria-pressed', 'false')
    this.lockButton.textContent = 'Zamknúť text'
    this.lockButton.title = 'Zamknutie umožní kresliť na spoločné pozadie aj za textom.'
    this.element.querySelector('[data-pane="text"] .workbench-actions')!.append(this.lockButton)
    this.lockButton.addEventListener('click', () => this.setTextLocked(!this.textLocked))
    this.canvasSurface.addEventListener('pointermove', event => {
      if (this.textLocked || !this.attached || !event.buttons ||
          this.panels.get('text')?.popup || this.panels.get('canvas')?.popup) return
      const bounds = this.textSurface.getBoundingClientRect()
      if (event.clientX >= bounds.left && event.clientX < bounds.right &&
          event.clientY >= bounds.top && event.clientY < bounds.bottom) {
        this.host().endInteraction(window)
        event.stopPropagation()
      }
    }, true)
    window.addEventListener('mo-workbench-reset', this.reset)
    window.addEventListener('beforeunload', this.warnScratch)
    this.element.querySelector('[data-document-slot]')!.append(editorPanel)
    this.documentActions = editorPanel.querySelector<HTMLElement>('.reader-editor-actions')!
    this.documentActions.remove()
    for (const name of ['text', 'canvas']) {
      const pane = this.element.querySelector<HTMLElement>(`[data-pane="${name}"]`)!
      const field = document.createElement('div')
      field.className = 'workbench-control-field'
      field.setAttribute('aria-label', name === 'text' ? 'Funkcie textového editora' : 'Funkcie kanvasu')
      field.tabIndex = 0
      field.append(pane.querySelector('.workbench-toolbar')!, pane.querySelector('.workbench-resize')!)
      pane.prepend(field)
    }
    this.textTools.dataset.textTools = ''
    this.drawingTools.dataset.drawingTools = ''
    this.drawingTools.hidden = true
    this.panelsForControls('text').append(this.textTools)
    this.panelsForControls('canvas').append(this.drawingTools)
    this.status.remove()
    this.panelsForControls('canvas').append(this.status)
    for (const name of ['text', 'canvas']) {
      const pane = this.element.querySelector<HTMLElement>(`[data-pane="${name}"]`)!
      const home = this.element.querySelector<HTMLElement>(`[data-pane-home="${name}"]`)!
      this.panels.set(name, { pane, home })
      pane.addEventListener('click', event => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button')
        if (!button) return
        if (button.dataset.popout) this.popout(name)
        if (button.dataset.resize) this.resize(name)
        if (button.dataset.source === 'scratch' && !this.scratch) this.startScratch()
        else if (button.dataset.source) this.selectSource(button.dataset.source)
        if (button.hasAttribute('data-download-scratch')) this.downloadScratch()
        if (button.dataset.canvas) {
          const insert = button.dataset.canvas === 'insert'
          if (insert && this.textLocked) this.setTextLocked(false)
          this.canvasSurface.querySelector<HTMLElement>('[data-desk-slot]')!.hidden = insert
          this.canvasSurface.querySelector<HTMLElement>('[data-drawing-slot]')!.hidden = !insert
          pane.querySelector<HTMLElement>('[data-desk-controls]')!.hidden = insert
          this.drawingTools.hidden = !insert
          pane.querySelectorAll<HTMLButtonElement>('[data-canvas]').forEach(b => b.setAttribute('aria-pressed', String(b === button)))
        }
      })
    }
    this.combineControls()
  }
  private combineControls(): void {
    this.combinedPanel.className = 'workbench-pane workbench-unified'
    this.combinedPanel.setAttribute('aria-label', 'Spoločné nástroje textu a kanvasu')
    this.combinedPanel.innerHTML = `<nav class="workbench-categories" aria-label="Kategórie spoločných nástrojov"></nav><div class="workbench-unified-content"></div>`
    const navigation = this.combinedPanel.querySelector('nav')!
    for (const [id, title] of [['text', 'Text'], ['drawing', 'Kreslenie'], ['colors', 'Farby'], ['objects', 'Objekty'], ['search', 'Hľadanie'], ['history', 'História'], ['view', 'Pohľad'], ['files', 'Súbory']]) {
      const button = document.createElement('button')
      button.type = 'button'; button.textContent = title; button.dataset.workbenchCategory = id
      button.addEventListener('mousedown', event => event.preventDefault())
      button.addEventListener('click', () => { this.category = id; this.filterControls() })
      navigation.append(button)
    }
    const content = this.combinedPanel.querySelector('.workbench-unified-content')!
    const shared = document.createElement('div')
    shared.className = 'workbench-shared-options'
    shared.innerHTML = `<label data-control-category="colors">Spoločná farba <input type="color" value="#ffffff" aria-label="Spoločná farba textu a štetca" data-shared-color></label><label data-control-category="drawing">Spoločná hrúbka <input type="range" min="1" max="40" value="2" aria-label="Spoločná hrúbka štetca" data-shared-size><output data-shared-size-output>2</output></label>`
    content.append(shared)
    for (const panel of this.panels.values()) content.append(panel.pane)
    this.combinedHome.append(this.combinedPanel)
    this.element.querySelector('.workbench-split')!.prepend(this.combinedHome)
    this.element.querySelectorAll('[data-pane-home]').forEach(home => home.remove())
    this.panels.get('canvas')!.pane.querySelector<HTMLElement>('[data-desk-controls]')!.dataset.unifiedControls = 'true'
    for (const panel of this.panels.values()) {
      this.tag(panel.pane.querySelector('.workbench-resize'), 'view')
      panel.pane.querySelectorAll('[data-resize], [data-popout]').forEach(node => this.tag(node, 'view'))
    }
    this.tag(this.documentActions, 'files')
    this.tag(this.scratchActions, 'files')
    shared.addEventListener('input', event => {
      const input = event.target as HTMLInputElement
      if (input.hasAttribute('data-shared-color')) this.changeBrush({ color: input.value })
      if (input.hasAttribute('data-shared-size')) this.changeBrush({ size: Number(input.value) })
    })
    this.combinedPanel.addEventListener('input', event => {
      const input = event.target as HTMLInputElement
      if (input.matches('[aria-label="Farba textu"], [aria-label="Farba pera"]')) this.changeBrush({ color: input.value })
      if (input.matches('[aria-label="Hrúbka čiary"]')) this.changeBrush({ size: Number(input.value) })
    })
    this.combinedPanel.addEventListener('change', event => {
      const input = event.target as HTMLSelectElement
      if (input.matches('[aria-label="Nástroj kreslenia"]')) this.changeBrush({ tool: input.value === 'rectangle' ? 'rect' : input.value })
    })
    this.canvasSurface.addEventListener('mo-desk-brush', event => {
      const value = (event as CustomEvent<{ color: string; size: number; tool: string }>).detail
      this.changeBrush(value)
    })
    this.canvasSurface.addEventListener('mo-desk-ready', () => {
      this.attached = true
      this.changeBrush({ color: this.sharedColor, size: this.sharedSize, tool: this.sharedTool }, false)
      this.filterControls()
    })
    this.filterControls()
  }
  private tag(node: Element | null, category: string): void {
    if (node instanceof HTMLElement) node.dataset.controlCategory = category
  }
  private arrangeEditorControls(): void {
    for (const controls of [this.scratch?.controls, this.documentControls]) {
      if (!controls) continue
      this.tag(controls.querySelector('.rich-find'), 'search')
      for (const node of controls.querySelectorAll('.rich-tools > *')) {
        this.tag(node, node.matches('[data-history]') ? 'history' :
          node.querySelector('input[type="color"]') || node.textContent === 'Bez zvýraznenia' ? 'colors' : 'text')
      }
      const color = controls.querySelector<HTMLInputElement>('[aria-label="Farba textu"]')
      if (color) color.closest('label')!.hidden = true
    }
    for (const node of this.drawingTools.querySelectorAll('.rich-tools > *, .drawing-controls > label, .drawing-controls > button')) {
      const label = node.querySelector('input')?.getAttribute('aria-label')
      const action = (node as HTMLElement).dataset.action
      this.tag(node, label === 'Farba papiera' || label === 'Farba pera' ? 'colors' :
        action === 'undo' || action === 'redo' ? 'history' :
        action === 'note' || action === 'insert' || node.matches('.drawing-controls > label') ? 'objects' : 'drawing')
    }
  }
  private filterControls(): void {
    this.arrangeEditorControls()
    this.combinedPanel.querySelectorAll<HTMLButtonElement>('[data-workbench-category]').forEach(button =>
      button.setAttribute('aria-pressed', String(button.dataset.workbenchCategory === this.category)))
    this.combinedPanel.querySelectorAll<HTMLElement>('[data-control-category]').forEach(node => {
      node.hidden = node.dataset.controlCategory !== this.category
    })
    for (const controls of [this.scratch?.controls, this.documentControls]) {
      const input = controls?.querySelector('[aria-label="Farba textu"]')
      if (input) (input.closest('label') as HTMLElement).hidden = true
    }
    if (this.attached) {
      try { this.host().tools(null, this.category, window) }
      catch (error) { this.status.textContent = String(error) }
    }
  }
  private changeBrush(value: { color?: string; size?: number; tool?: string }, applyText = true): void {
    if (value.color && !/^#[0-9a-f]{6}$/i.test(value.color)) {
      this.status.textContent = 'Neplatná spoločná farba. Použite farbu v tvare #RRGGBB.'
      return
    }
    if (value.color) this.sharedColor = value.color
    if (value.size !== undefined) this.sharedSize = Math.min(40, Math.max(1, value.size))
    if (value.tool && ['select', 'pen', 'eraser', 'line', 'rect', 'ellipse'].includes(value.tool)) this.sharedTool = value.tool
    this.combinedPanel.querySelector<HTMLInputElement>('[data-shared-color]')!.value = this.sharedColor
    this.combinedPanel.querySelector<HTMLInputElement>('[data-shared-size]')!.value = String(this.sharedSize)
    this.combinedPanel.querySelector('output[data-shared-size-output]')!.textContent = String(this.sharedSize)
    const documentActive = this.textSurface.querySelector<HTMLElement>('[data-document-slot]')!.hidden === false
    const rich = documentActive ? this.documentEditor : this.scratch
    if (rich) {
      rich.controls.querySelector<HTMLInputElement>('[aria-label="Farba textu"]')!.value = this.sharedColor
      if (value.color && applyText && !this.textLocked && rich.editor.isEditable) rich.editor.chain().focus().setColor(this.sharedColor).run()
      const pad = rich.pad.controls
      pad.querySelector<HTMLInputElement>('[aria-label="Farba pera"]')!.value = this.sharedColor
      pad.querySelector<HTMLInputElement>('[aria-label="Hrúbka čiary"]')!.value = String(this.sharedSize)
      if (this.sharedTool !== 'select') pad.querySelector<HTMLSelectElement>('select')!.value = this.sharedTool === 'rect' ? 'rectangle' : this.sharedTool
    }
    if (this.attached) {
      try { this.host().tools({ color: this.sharedColor, size: this.sharedSize, tool: this.sharedTool }, null, window) }
      catch (error) { this.status.textContent = String(error) }
    }
  }
  private panelsForControls(name: string): HTMLElement {
    return this.element.querySelector<HTMLElement>(`[data-pane="${name}"] .workbench-control-field`)!
  }
  private host(): WorkbenchHost {
    if (window.parent === window || window.parent.location.origin !== location.origin || !window.parent.MOGrimoireWorkbench)
      throw new Error('Pracovňa a spoločný stôl sú dostupné v miestnej hre. Otvorte Grimoár cez Knižnicu hry.')
    return window.parent.MOGrimoireWorkbench
  }
  activate(): void {
    if (this.attached) return
    try {
      const host = this.host()
      host.attach('desk', this.canvasSurface.querySelector<HTMLElement>('[data-desk-slot]')!, window,
        this.panels.get('canvas')!.pane.querySelector<HTMLElement>('[data-desk-controls]')!)
      this.attached = true
      this.status.textContent = ''
    } catch (error) { this.status.textContent = String(error) }
  }
  selectSource(source: string): void {
    if (source !== 'scratch' && source !== 'document') return
    if (source === 'document' && !this.documentPad) return
    const pane = this.panels.get('text')!.pane
    this.textSurface.querySelector<HTMLElement>('[data-scratch-slot]')!.hidden = source !== 'scratch'
    this.textSurface.querySelector<HTMLElement>('[data-document-slot]')!.hidden = source !== 'document'
    pane.querySelectorAll<HTMLButtonElement>('[data-source]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.source === source)))
    const pad = source === 'document' ? this.documentPad : this.scratch?.pad
    const drawing = this.canvasSurface.querySelector<HTMLElement>('[data-drawing-slot]')!
    if (pad) {
      drawing.replaceChildren(pad.element)
      this.drawingTools.replaceChildren(pad.controls)
    } else {
      drawing.textContent = 'Klikni do čistého poľa a začni nový text alebo otvor dokument.'
      this.drawingTools.replaceChildren()
    }
    const controls = source === 'document' ? this.documentControls : this.scratch?.controls
    const actions = source === 'document' ? this.documentActions : this.scratchActions
    this.textTools.replaceChildren(...(controls ? [controls, actions] : [actions]))
    this.changeBrush({}, false)
    this.filterControls()
    this.refreshRoot()
    this.applyTextLock()
  }
  private setTextLocked(locked: boolean): void {
    if (locked) this.restoreAll()
    if (this.attached) this.host().endInteraction(window)
    this.textLocked = locked
    if (locked) this.panels.get('canvas')!.pane.querySelector<HTMLButtonElement>('[data-canvas="desk"]')!.click()
    this.applyTextLock()
    if (!locked) {
      const textbox = this.textSurface.querySelector<HTMLElement>('[data-scratch-slot]:not([hidden]) .tiptap, [data-document-slot]:not([hidden]) .tiptap')
      textbox?.focus({ preventScroll: true })
    }
  }
  private applyTextLock(): void {
    this.stage.classList.toggle('text-locked', this.textLocked)
    this.textSurface.inert = this.textLocked
    this.textTools.inert = this.textLocked
    this.scratch?.editor.setEditable(!this.textLocked)
    this.lockDocument(this.textLocked)
    this.lockButton.setAttribute('aria-pressed', String(this.textLocked))
    this.lockButton.textContent = this.textLocked ? 'Odomknúť text' : 'Zamknúť text'
  }
  setDrawingPad(pad: DrawingPad, title = 'Text dokumentu', rich?: RichEditor): void {
    this.documentPad = pad
    this.documentEditor = rich
    this.documentControls = rich?.controls
    const button = this.panels.get('text')!.pane.querySelector<HTMLButtonElement>('[data-source="document"]')!
    button.hidden = false; button.textContent = title; button.title = title
    this.selectSource('document')
  }
  private startScratch(): void {
    if (!this.scratch) {
      this.scratch = new RichEditor('', () => { this.scratchDirty = true })
      this.scratch.editor.view.dom.setAttribute('aria-label', 'Nový text – koncept')
      const slot = this.textSurface.querySelector<HTMLElement>('[data-scratch-slot]')!
      const note = document.createElement('p'); note.className = 'scratch-note'
      note.textContent = 'Koncept je iba v otvorenej hre. Pred zatvorením si stiahni jeho kópiu.'
      const download = document.createElement('button'); download.type = 'button'; download.dataset.downloadScratch = ''
      download.textContent = 'Stiahnuť koncept (.json)'
      this.scratchActions.replaceChildren(note, download)
      slot.replaceChildren(this.scratch.element)
    }
    this.selectSource('scratch')
    this.scratch.focus()
  }
  private downloadScratch(): void {
    if (!this.scratch) return
    const doc = this.panels.get('text')!.pane.ownerDocument
    const url = URL.createObjectURL(new Blob([JSON.stringify({format:'grimoire-rich-concept',version:1,document:this.scratch.editor.getJSON()},null,2)],{type:'application/json'}))
    const link = doc.createElement('a'); link.href = url; link.download = 'grimoar-koncept.json'
    doc.body.append(link); link.click(); link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  private refreshRoot(): void {
    this.scratch?.updateRoot()
    this.rootChanged()
  }
  clearDocument(): void {
    this.restoreAll()
    this.documentPad = undefined
    this.documentControls = undefined
    this.documentEditor = undefined
    this.panels.get('text')!.pane.querySelector<HTMLButtonElement>('[data-source="document"]')!.hidden = true
    this.selectSource('scratch')
  }
  private resize(name: string): void {
    const pane = this.panels.get(name)!.pane
    const width = pane.querySelector<HTMLInputElement>(`[data-width="${name}"]`)!
    const height = pane.querySelector<HTMLInputElement>(`[data-height="${name}"]`)!
    if (!width.reportValidity() || !height.reportValidity()) return
    if (name === 'text') {
      for (const surface of this.textSurface.querySelectorAll<HTMLElement>('[data-scratch-slot], [data-document-slot]')) {
        surface.style.width = width.value + 'px'; surface.style.minHeight = height.value + 'px'
        surface.style.maxWidth = 'none'
      }
    } else {
      try { this.host().resize('desk', Number(width.value), Number(height.value), window) }
      catch (error) { this.status.textContent = String(error); return }
    }
    this.status.textContent = `Rozhranie ${name === 'text' ? 'editora' : 'kanvasu'}: ${width.value} × ${height.value} CSS px.`
  }
  private popout(name: string): void {
    if (this.textLocked) this.setTextLocked(false)
    const panel = this.panels.get(name)!
    if (panel.popup && !panel.popup.closed) { panel.popup.focus(); return }
    this.restoreAll()
    const popup = window.open('about:blank', '_blank', 'popup=yes,width=1100,height=850,resizable=yes,scrollbars=yes')
    if (!popup) { this.status.textContent = 'Povoľte vyskakovacie okná pre miestnu hru a skúste znova.'; return }
    try {
      const doc = popup.document
      doc.documentElement.lang = 'sk'; doc.documentElement.dataset.theme = 'dark'
      doc.title = name === 'text' ? 'Textový editor · Grimoár' : 'Kanvas · Grimoár'
      for (const stylesheet of document.querySelectorAll('link[rel="stylesheet"], style')) {
        const clone = stylesheet.cloneNode(true) as HTMLElement
        if (stylesheet instanceof HTMLLinkElement) (clone as HTMLLinkElement).href = stylesheet.href
        doc.head.append(clone)
      }
      doc.body.className = 'grimoire-popup'
      const back = doc.createElement('button'); back.type = 'button'; back.textContent = 'Vrátiť panel do Grimoára'
      doc.body.append(back)
      const restore = () => {
        if (panel.popup !== popup) return
        if (name === 'text') this.stage.append(this.textSurface)
        else this.stage.prepend(this.canvasSurface)
        this.combinedHome.append(this.combinedPanel); panel.popup = undefined; panel.restore = undefined
        this.stage.classList.toggle('text-detached', !!this.panels.get('text')?.popup)
        this.stage.classList.toggle('canvas-detached', !!this.panels.get('canvas')?.popup)
        this.refreshRoot()
      }
      panel.popup = popup; panel.restore = restore
      this.stage.classList.toggle('text-detached', !!this.panels.get('text')?.popup)
      this.stage.classList.toggle('canvas-detached', !!this.panels.get('canvas')?.popup)
      doc.body.append(this.combinedPanel, name === 'text' ? this.textSurface : this.canvasSurface)
      this.refreshRoot()
      back.addEventListener('click', () => { restore(); popup.close() })
      popup.addEventListener('pagehide', restore, { once: true })
      popup.focus()
    } catch (error) {
      panel.restore?.(); popup.close(); this.status.textContent = `Okno sa nepodarilo pripraviť: ${String(error)}`
    }
  }
  restoreAll(): void {
    for (const panel of this.panels.values()) {
      const popup = panel.popup
      panel.restore?.()
      if (popup && !popup.closed) popup.close()
    }
  }
  destroy(): void {
    window.removeEventListener('mo-workbench-reset', this.reset)
    window.removeEventListener('beforeunload', this.warnScratch)
    this.restoreAll()
    this.textLocked = false
    this.applyTextLock()
    if (this.attached) this.host().detach('desk', window)
    this.scratch?.editor.destroy()
    this.scratch = undefined
  }
}
