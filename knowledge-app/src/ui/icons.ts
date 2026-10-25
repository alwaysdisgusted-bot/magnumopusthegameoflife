const paths = {
  book: '<path d="M12 6v15M3 4h4a7 7 0 0 1 5 2 7 7 0 0 1 5-2h4v15h-4a7 7 0 0 0-5 2 7 7 0 0 0-5-2H3z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  folder: '<path d="M3 7V5h7l2 3h9v12H3z"/>',
  file: '<path d="M14 3H5v18h14V8zM14 3v5h5M8 13h8M8 17h5"/>',
  text: '<path d="M4 5h16M12 5v15M8 20h8M4 8V5M20 8V5"/>',
  arrow: '<path d="M4 12h15m-5-5 5 5-5 5"/>',
  back: '<path d="M20 12H5m5-5-5 5 5 5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  focus: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3h.01"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  sparkle: '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z"/>',
  moon: '<path d="M20 14A8 8 0 0 1 10 4a8.5 8.5 0 1 0 10 10Z"/>',
} as const

export function icon(name: keyof typeof paths, className = ''): string {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`
}

export const sigil = '<svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M20 3 35 29H5L20 3Z" stroke="currentColor" stroke-width="1.1"/><circle cx="20" cy="21" r="12" stroke="currentColor" stroke-width="1.1"/><path d="M20 11v26M10 21h20" stroke="currentColor" stroke-width="1.1"/><circle cx="20" cy="21" r="3" fill="currentColor"/></svg>'
