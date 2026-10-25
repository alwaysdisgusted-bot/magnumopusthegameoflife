export function mountScreenPager(root: HTMLElement): () => void {
  const workbench = root.querySelector<HTMLElement>('#grimoire-workbench')!
  const home = workbench.parentNode!
  const sibling = workbench.nextSibling
  const viewport = document.createElement('div')
  viewport.className = 'grimoire-screen-viewport'
  const reading = document.createElement('div')
  reading.className = 'grimoire-screen-page'
  reading.id = 'grimoire-reading-screen'
  const editing = document.createElement('div')
  editing.className = 'grimoire-screen-page'
  editing.id = 'grimoire-editing-screen'
  const controls = document.createElement('nav')
  controls.className = 'grimoire-screen-controls'
  controls.setAttribute('aria-label', 'Dve stránky Grimoára')
  controls.innerHTML = `
    <button type="button" data-screen-previous aria-controls="${reading.id}" aria-label="Horná strana: Grimoár a čítačka">↑<span>Čítačka</span></button>
    <span role="status" aria-live="polite" aria-atomic="true"></span>
    <button type="button" data-screen-next aria-controls="${editing.id}" aria-label="Dolná strana: Textový editor a kanvas">↓<span>Editor</span></button>`
  const previous = controls.querySelector<HTMLButtonElement>('[data-screen-previous]')!
  const next = controls.querySelector<HTMLButtonElement>('[data-screen-next]')!
  const status = controls.querySelector<HTMLElement>('[role="status"]')!
  reading.append(...Array.from(root.childNodes))
  editing.append(workbench)
  viewport.append(reading, editing)
  root.append(controls, viewport)
  root.classList.add('has-screen-pager')
  document.documentElement.classList.add('has-grimoire-screen-pager')

  function show(view: string): void {
    const lower = view === 'workbench'
    // Both surfaces stay mounted; visibility changes synchronously, without a transition.
    reading.hidden = lower
    editing.hidden = !lower
    previous.disabled = !lower
    next.disabled = lower
    previous.setAttribute('aria-pressed', String(!lower))
    next.setAttribute('aria-pressed', String(lower))
    status.textContent = lower ? '2 / 2' : '1 / 2'
  }
  const change = () => show(root.dataset.grimoireView ?? 'reading')
  previous.addEventListener('click', () => root.querySelector<HTMLButtonElement>('button[data-grimoire-view="reading"]')!.click())
  next.addEventListener('click', () => root.querySelector<HTMLButtonElement>('button[data-grimoire-view="workbench"]')!.click())
  root.addEventListener('grimoire-view-change', change)
  change()

  return () => {
    root.removeEventListener('grimoire-view-change', change)
    home.insertBefore(workbench, sibling)
    root.append(...Array.from(reading.childNodes))
    viewport.remove()
    controls.remove()
    root.classList.remove('has-screen-pager')
    document.documentElement.classList.remove('has-grimoire-screen-pager')
  }
}
