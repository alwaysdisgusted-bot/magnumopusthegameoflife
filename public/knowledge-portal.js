(() => {
  'use strict';
  const address = '/knowledge-system/index.html';
  function render() {
    return `<section id="knowledge-portal" class="knowledge-portal" aria-labelledby="knowledge-portal-title"><header class="knowledge-portal-header"><div><p class="eyebrow">TVOJA OSOBNÁ PRACOVŇA</p><h2 id="knowledge-portal-title">Mapa poznania</h2><p>Vlastný strom, pojmy a dokumenty na samostatnej stránke.</p></div><a class="btn primary small" href="${address}" target="_blank" rel="noopener noreferrer">Otvoriť celú mapu ↗</a></header><iframe id="knowledge-portal-frame" class="knowledge-portal-frame" src="${address}?embed=1" title="Samostatná mapa poznania — strom a vyhľadávanie" loading="lazy" referrerpolicy="same-origin" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox"></iframe><footer><span>Vlastné dokumenty mapy sa ukladajú v tomto prehliadači. Exportuj ich priamo v mape; herná ZIP záloha ich nezahŕňa.</span><button class="btn ghost small" type="button" data-action="navigate" data-view="study">Staršie študijné zápisky</button></footer></section>`;
  }
  // Keep the connected iframe in place when wallet/profile state rerenders.
  // Moving or detaching an iframe would restart its independent application.
  function renderKeepingFrame(html) {
    const portal = document.getElementById('knowledge-portal');
    const current = document.querySelector('#main .profile-page');
    if (!portal || !current || portal.parentElement !== current) return false;
    const template = document.createElement('template'); template.innerHTML = html;
    const replacement = template.content.querySelector('.profile-page');
    if (!replacement) return false;
    for (const node of Array.from(document.getElementById('main').childNodes)) if (node !== current) node.remove();
    for (const node of Array.from(current.childNodes)) if (node !== portal) node.remove();
    for (const attribute of Array.from(current.attributes)) current.removeAttribute(attribute.name);
    for (const attribute of Array.from(replacement.attributes)) current.setAttribute(attribute.name, attribute.value);
    let beforePortal = true;
    for (const node of Array.from(replacement.childNodes)) {
      if (beforePortal) current.insertBefore(node, portal); else current.appendChild(node);
      if (node.nodeType === 1 && node.classList.contains('page-header')) beforePortal = false;
    }
    return true;
  }
  window.MOStandaloneKnowledge = Object.freeze({ render, renderKeepingFrame });
})();
