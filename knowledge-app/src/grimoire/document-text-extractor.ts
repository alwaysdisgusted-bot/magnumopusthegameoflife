import { unzipSync, strFromU8 } from 'fflate'
import type { SourcePage } from '../storage/source-store'

export function canExtractDocumentText(name: string): boolean {
  return /\.(txt|md|markdown|pdf|docx|docm|dotx|dotm|pptx|pptm|ppsx|ppsm|potx|potm)$/i.test(name)
}

export async function extractDocumentText(file: File): Promise<{ text: string; pages?: SourcePage[] }> {
  if (file.size > 50 * 1024 * 1024) throw new Error('Dokument prekračuje limit 50 MB.')
  if (/\.pdf$/i.test(file.name)) {
    const { extractPdfText } = await import('./pdf-text-extractor')
    const pages = await extractPdfText(file)
    return { text: pages.map((page) => page.text).join('\n\n'), pages }
  }
  if (/\.(txt|md|markdown)$/i.test(file.name)) return { text: await file.text() }
  if (!canExtractDocumentText(file.name)) throw new Error('Tento formát zatiaľ nemá podporované čítanie textu.')

  const word = /\.(docx|docm|dotx|dotm)$/i.test(file.name)
  let expandedSize = 0
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (entry) => {
      const include = word ? entry.name === 'word/document.xml' :
        /^ppt\/slides\/slide\d+\.xml$/.test(entry.name) ||
        entry.name === 'ppt/presentation.xml' || entry.name === 'ppt/_rels/presentation.xml.rels'
      if (include) {
        expandedSize += entry.originalSize
        if (expandedSize > 50 * 1024 * 1024) throw new Error('Rozbalený text prekračuje limit 50 MB.')
      }
      return include
    },
  })
  const parseXml = (name: string): Document => {
    const xml = new DOMParser().parseFromString(strFromU8(entries[name]), 'application/xml')
    if (xml.getElementsByTagName('parsererror').length > 0) throw new Error('Textová časť dokumentu je poškodená.')
    return xml
  }
  let names = Object.keys(entries).filter((name) => word || /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  if (!word && entries['ppt/presentation.xml'] && entries['ppt/_rels/presentation.xml.rels']) {
    const relationships = Array.from(parseXml('ppt/_rels/presentation.xml.rels').getElementsByTagNameNS('*', 'Relationship'))
    const slideIds = Array.from(parseXml('ppt/presentation.xml').getElementsByTagNameNS('*', 'sldId'))
    names = slideIds.map((slide) => {
      const id = slide.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
      const relation = relationships.find((item) => item.getAttribute('Id') === id)
      const target = relation?.getAttribute('Target') ?? ''
      const name = target.startsWith('/ppt/') ? target.slice(1) : `ppt/${target.replace(/^\.\//, '')}`
      if (relation?.getAttribute('TargetMode') === 'External' || !/^ppt\/slides\/slide\d+\.xml$/.test(name) || !entries[name]) {
        throw new Error('Prezentácia obsahuje neplatný odkaz na snímku.')
      }
      return name
    })
  }
  if (names.length === 0) throw new Error('Dokument neobsahuje podporovaný text alebo je poškodený.')
  const texts = names.map((name) => {
    const xml = parseXml(name)
    const namespace = word
      ? 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
      : 'http://schemas.openxmlformats.org/drawingml/2006/main'
    const paragraphs = Array.from(xml.getElementsByTagNameNS(namespace, 'p'))
    return paragraphs.map((paragraph) => {
      let text = ''
      const visit = (node: Element): void => {
        if (node.namespaceURI === namespace) {
          if (node.localName === 't') { text += node.textContent ?? ''; return }
          if (node.localName === 'tab') { text += '\t'; return }
          if (node.localName === 'br' || node.localName === 'cr') { text += '\n'; return }
        }
        Array.from(node.children).forEach(visit)
      }
      visit(paragraph)
      return text
    }).join('\n')
  })
  const text = texts.join('\n\n')
  if (!text.trim()) throw new Error('Dokument neobsahuje čitateľný text. Obrázky a skeny sa nespracúvajú.')
  return word ? { text } : { text, pages: texts.map((pageText, i) => ({ pageNumber: i + 1, text: pageText })) }
}
