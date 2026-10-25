const logoPath = `${import.meta.env.BASE_URL}magnum-opus-logo.png`

export function showStartupError(root: HTMLElement, message: string, onContinueTemporarily: () => void): void {
  root.innerHTML = `
    <main class="auth-shell">
      <section class="auth-card" aria-labelledby="startup-error-title">
        <div class="auth-brand">
          <img class="auth-logo" src="${logoPath}" alt="" />
          <span>MAGNUM OPUS <span>KNOWLEDGE</span></span>
        </div>
        <p class="eyebrow">Osobný Grimoár</p>
        <h1 id="startup-error-title">Pripojenie nie je dostupné</h1>
        <p class="auth-message" role="alert"></p>
        <button id="temporary-mode" class="temporary-mode" type="button">Pokračovať dočasne</button>
        <p class="auth-footnote">Dočasný režim ukladá obsah iba v tejto otvorenej stránke.</p>
      </section>
    </main>
  `
  const messageNode = root.querySelector<HTMLElement>('[role="alert"]')
  const temporaryButton = root.querySelector<HTMLButtonElement>('#temporary-mode')
  if (!messageNode || !temporaryButton) throw new Error('Nepodarilo sa zobraziť stav pripojenia.')
  messageNode.textContent = message
  temporaryButton.addEventListener('click', onContinueTemporarily)
}
