import { Editor, Node as EditorNode, type Extensions, type JSONContent } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import StarterKit from '@tiptap/starter-kit'
import './editor.css'
import { TextStyle, Color, FontSize } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import { decodeDocument, plainDocument, RICH_PREFIX, validateDocument, type Drawing } from './document'
import { drawingElement, DrawingPad } from './drawing'

export function editorExtensions(): Extensions {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false, code: false, codeBlock: false, blockquote: false, strike: false, horizontalRule: false, trailingNode: false }),
    TextStyle, Color, FontSize, Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    EditorNode.create({
      name: 'drawing', group: 'block', atom: true,
      addAttributes: () => ({ drawing: { default: null, rendered: false } }),
      parseHTML: () => [],
      renderHTML: ({ node }) => {
        const figure = document.createElement('figure')
        figure.className = 'editor-drawing'; figure.append(drawingElement(node.attrs.drawing as Drawing))
        return figure
      },
    }),
    EditorNode.create({
      name: 'sticky', group: 'block', atom: true,
      addAttributes: () => ({ background: { default: '#fff4bb', rendered: false }, text: { default: '', rendered: false } }),
      parseHTML: () => [],
      renderHTML: ({ node }) => {
        const note = document.createElement('aside')
        note.className = 'editor-sticky'; note.style.backgroundColor = node.attrs.background
        const rgb = String(node.attrs.background).slice(1).match(/../g)!.map(value => parseInt(value, 16))
        note.style.color = rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 < 140 ? '#ffffff' : '#23172a'
        note.textContent = node.attrs.text; note.setAttribute('aria-label', 'Farebný lístok')
        return note
      },
    }),
  ]
}

export function renderRichDocument(container: HTMLElement, value: string): Editor {
  const content = decodeDocument(value)
  return new Editor({ element: container, extensions: editorExtensions(), content, editable: false, injectCSS: false })
}

export class RichEditor {
  readonly element = document.createElement('div')
  readonly controls = document.createElement('div')
  readonly editor: Editor
  readonly pad: DrawingPad
  private readonly feedback: HTMLElement
  constructor(value: string, change: (value: string) => void) {
    this.element.className = 'rich-editor-layout'
    this.element.innerHTML = `<section class="rich-text-panel" aria-label="Úprava textu">
      <h5>Text</h5><div class="rich-tools" role="toolbar" aria-label="Formátovanie textu"></div>
      <div class="rich-find"><label>Nájsť<input type="search" aria-label="Nájsť v upravenom texte"></label><label>Nahradiť<input type="text" aria-label="Nahradiť textom"></label>
      <button type="button" data-find="next">Ďalšia zhoda</button><button type="button" data-find="replace">Nahradiť zhodu</button><button type="button" data-find="all">Nahradiť všetko</button></div>
      <p class="rich-feedback" role="status" aria-live="polite"></p><div class="rich-document"></div></section>`
    this.controls.className = 'rich-editor-controls'
    const textPanel = this.element.querySelector<HTMLElement>('.rich-text-panel')!
    for (const node of Array.from(textPanel.children)) {
      if (!node.classList.contains('rich-document')) this.controls.append(node)
    }
    textPanel.prepend(this.controls)
    this.feedback = this.controls.querySelector('.rich-feedback')!
    this.editor = new Editor({
      element: this.element.querySelector<HTMLElement>('.rich-document')!,
      extensions: editorExtensions(), content: decodeDocument(value), injectCSS: false,
      editorProps: {
        attributes: { role: 'textbox', 'aria-label': 'Text upravenej verzie', 'aria-multiline': 'true', spellcheck: 'true' },
        // Import only clipboard text. No pasted HTML, remote resources or active content enters the schema.
        handlePaste: (_view, event) => {
          const text = event.clipboardData?.getData('text/plain') ?? ''
          if (text.length > 1000000) { this.feedback.textContent = 'Vkladaný text je príliš veľký (limit 1 milión znakov).'; return true }
          this.editor.commands.insertContent(plainDocument(text))
          return true
        },
        handleDrop: () => true,
      },
      onUpdate: () => {
        const doc = this.editor.getJSON()
        change(RICH_PREFIX + JSON.stringify(doc))
        try { validateDocument(doc); this.feedback.textContent = '' }
        catch (error) { this.feedback.textContent = String(error) }
      },
      onTransaction: () => this.updateButtons(),
    })
    const tools = this.controls.querySelector<HTMLElement>('.rich-tools')!
    const button = (label: string, action: () => void, active?: string) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label
      if (active) b.dataset.active = active
      b.addEventListener('mousedown', e => e.preventDefault())
      b.addEventListener('click', action); tools.append(b)
    }
    button('Tučné', () => { this.editor.chain().focus().toggleBold().run() }, 'bold')
    button('Kurzíva', () => { this.editor.chain().focus().toggleItalic().run() }, 'italic')
    button('Podčiarknuté', () => { this.editor.chain().focus().toggleUnderline().run() }, 'underline')
    const select = (label: string, values: [string, string][], action: (value: string) => void) => {
      const wrapper = document.createElement('label'); wrapper.append(label)
      const input = document.createElement('select'); input.setAttribute('aria-label', label)
      values.forEach(([value, title]) => input.add(new Option(title, value)))
      input.addEventListener('change', () => action(input.value)); wrapper.append(input); tools.append(wrapper)
    }
    select('Štýl odseku', [['0', 'Odsek'], ['1', 'Nadpis 1'], ['2', 'Nadpis 2'], ['3', 'Nadpis 3']], value => {
      if (value === '0') this.editor.chain().focus().setParagraph().run()
      else this.editor.chain().focus().setHeading({ level: Number(value) as 1 | 2 | 3 }).run()
    })
    select('Veľkosť písma', [10, 12, 14, 16, 18, 24, 32, 48].map(n => [String(n), String(n)]), value => { this.editor.chain().focus().setFontSize(`${value}px`).run() })
    const color = (label: string, value: string, action: (value: string) => void) => {
      const wrapper = document.createElement('label'); wrapper.append(label)
      const input = document.createElement('input'); input.type = 'color'; input.value = value; input.setAttribute('aria-label', label)
      input.addEventListener('input', () => action(input.value)); wrapper.append(input); tools.append(wrapper)
    }
    color('Farba textu', '#63366e', value => { this.editor.chain().focus().setColor(value).run() })
    color('Farba zvýraznenia', '#fff4bb', value => { this.editor.chain().focus().setHighlight({ color: value }).run() })
    button('Bez zvýraznenia', () => { this.editor.chain().focus().unsetHighlight().run() })
    select('Zarovnanie', [['left', 'Vľavo'], ['center', 'Na stred'], ['right', 'Vpravo'], ['justify', 'Do bloku']], value => { this.editor.chain().focus().setTextAlign(value).run() })
    button('Odrážky', () => { this.editor.chain().focus().toggleBulletList().run() }, 'bulletList')
    button('Číslovaný zoznam', () => { this.editor.chain().focus().toggleOrderedList().run() }, 'orderedList')
    button('Späť', () => { this.editor.chain().focus().undo().run() })
    tools.lastElementChild!.setAttribute('data-history', 'undo')
    button('Znova', () => { this.editor.chain().focus().redo().run() })
    tools.lastElementChild!.setAttribute('data-history', 'redo')
    this.pad = new DrawingPad((type, attrs) => {
      try {
        const node: JSONContent = { type, attrs }
        validateDocument({ type: 'doc', content: [node] })
        this.editor.view.dispatch(closeHistory(this.editor.state.tr))
        this.editor.chain().focus().insertContent(node).run()
        this.editor.view.dispatch(closeHistory(this.editor.state.tr))
      } catch (error) { this.feedback.textContent = String(error) }
    })
    this.controls.querySelector('.rich-find')!.addEventListener('click', e => {
      const action = (e.target as HTMLElement).dataset.find
      if (action) this.find(action)
    })
    this.updateButtons()
  }

  private updateButtons(): void {
    if (!this.editor) return
    this.controls.querySelectorAll<HTMLButtonElement>('[data-active]').forEach(button => button.setAttribute('aria-pressed', String(this.editor.isActive(button.dataset.active!))))
    this.controls.querySelectorAll<HTMLButtonElement>('[data-history]').forEach(button => {
      button.disabled = button.dataset.history === 'undo' ? !this.editor.can().undo() : !this.editor.can().redo()
    })
  }

  private find(action: string): void {
    const inputs = this.controls.querySelectorAll<HTMLInputElement>('.rich-find input')
    const query = inputs[0].value
    const replacement = inputs[1].value
    if (!query) { this.feedback.textContent = 'Napíšte text na hľadanie. Hľadanie je presné a rozlišuje veľkosť písmen.'; return }
    const matches: { from: number; to: number }[] = []
    // Search across formatting boundaries inside each text block, never across drawings or paragraphs.
    this.editor.state.doc.descendants((node, pos) => {
      if (!node.isTextblock) return
      const text = node.textBetween(0, node.content.size, '\n', '\ufffc')
      for (let i = text.indexOf(query); i !== -1; i = text.indexOf(query, i + query.length)) matches.push({ from: pos + 1 + i, to: pos + 1 + i + query.length })
      return false
    })
    if (!matches.length) { this.feedback.textContent = 'Žiadna zhoda.'; return }
    const selection = this.editor.state.selection
    if (action !== 'next') this.editor.view.dispatch(closeHistory(this.editor.state.tr))
    if (action === 'all') {
      let transaction = this.editor.state.tr
      for (const match of matches.toReversed()) transaction = replacement ? transaction.insertText(replacement, match.from, match.to) : transaction.delete(match.from, match.to)
      this.editor.view.dispatch(transaction)
      this.feedback.textContent = `Nahradené zhody: ${matches.length}.`
    } else {
      const selected = matches.find(match => match.from === selection.from && match.to === selection.to)
      const match = action === 'replace' && selected ? selected : matches.find(match => match.from >= selection.to) ?? matches[0]
      this.editor.chain().focus().setTextSelection(match).run()
      if (action === 'replace') this.editor.commands.insertContentAt(match, replacement ? { type: 'text', text: replacement } : [])
      this.feedback.textContent = `Zhody: ${matches.length}.`
    }
    if (action !== 'next') this.editor.view.dispatch(closeHistory(this.editor.state.tr))
  }

  get value(): string { return RICH_PREFIX + JSON.stringify(this.editor.getJSON()) }
  canonicalValue(value: string): string {
    const doc = this.editor.schema.nodeFromJSON(decodeDocument(value))
    doc.check()
    return RICH_PREFIX + JSON.stringify(doc.toJSON())
  }
  focus(): void { this.editor.commands.focus() }
  updateRoot(): void { this.editor.view.updateRoot() }
}
