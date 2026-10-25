export const SUPPORTED_DOCUMENT_EXTENSIONS = [
  '.doc', '.docx', '.docm', '.dot', '.dotx', '.dotm',
  '.pdf',
  '.ppt', '.pptx', '.pps', '.ppsx', '.pptm', '.ppsm', '.pot', '.potx', '.potm',
  '.xlsx', '.xlsm',
  '.odt', '.ods', '.odp',
  '.rtf', '.html', '.htm', '.csv', '.tsv', '.json', '.xml', '.log', '.txt', '.md', '.markdown',
] as const

export const DOCUMENT_ACCEPT_VALUE = SUPPORTED_DOCUMENT_EXTENSIONS.join(',')

export function isSupportedDocument(fileName: string): boolean {
  const normalizedName = fileName.toLocaleLowerCase('en')
  return SUPPORTED_DOCUMENT_EXTENSIONS.some((extension) => normalizedName.endsWith(extension))
}
