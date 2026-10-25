import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

const MAX_PDF_SIZE_BYTES = 50 * 1024 * 1024
const MAX_PDF_PAGES = 500

export interface ExtractedPdfPage {
  pageNumber: number
  text: string
}

export class PdfTextExtractionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PdfTextExtractionError'
  }
}

export async function extractPdfText(file: File): Promise<ExtractedPdfPage[]> {
  if (file.size > MAX_PDF_SIZE_BYTES) {
    throw new PdfTextExtractionError('PDF prekračuje maximálnu podporovanú veľkosť 50 MB.')
  }

  const loadingTask = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  })

  try {
    const pdf = await loadingTask.promise
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new PdfTextExtractionError('PDF prekračuje limit 500 strán.')
    }

    const pages: ExtractedPdfPage[] = []
    let hasText = false

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      const text = content.items
        .flatMap((item) => 'str' in item ? [`${item.str}${item.hasEOL ? '\n' : ' '}`] : [])
        .join('')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()

      if (text) hasText = true
      pages.push({ pageNumber, text })
      page.cleanup()
    }

    if (!hasText) {
      throw new PdfTextExtractionError('PDF neobsahuje čitateľnú textovú vrstvu. Skenované PDF zatiaľ nie je podporované.')
    }

    return pages
  } catch (error) {
    if (error instanceof PdfTextExtractionError) throw error

    const message = error instanceof Error ? error.message : ''
    if (/password/i.test(message)) {
      throw new PdfTextExtractionError('PDF je chránené heslom a nemožno ho spracovať.')
    }
    throw new PdfTextExtractionError('PDF sa nepodarilo načítať. Skontrolujte, či súbor nie je poškodený alebo nepodporovaný.')
  } finally {
    await loadingTask.destroy()
  }
}
