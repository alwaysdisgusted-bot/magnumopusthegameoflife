(function () {
  'use strict';
  const slots = new Map();
  function trusted(source) {
    return source === document.getElementById('knowledge-library-grimoire-frame')?.contentWindow &&
      source.location.origin === window.location.origin && window.MOAuth?.isAuthenticated();
  }
  function engine(kind) { return kind === 'desk' ? window.MODesk : window.MOAcademy; }
  function claim(kind) {
    const slot = slots.get(kind);
    if (!slot || !window.MOAuth?.isAuthenticated()) return;
    if (slot.claimed) return;
    slot.claimed = true;
    slot.root.replaceChildren();
    if (kind === 'desk') { slot.root.id = 'desk-root'; slot.root.dataset.sharedSurface = 'true'; }
    engine(kind).embed(slot.root, slot.controlsRoot);
  }
  function release(kind) {
    const slot = slots.get(kind);
    if (!slot?.claimed) return;
    engine(kind).embed(null);
    slot.claimed = false;
    slot.root.replaceChildren();
    slot.controlsRoot?.replaceChildren();
    const button = slot.root.ownerDocument.createElement('button');
    button.textContent = 'Panel je otvorený na pôvodnej stránke. Prevziať sem';
    button.type = 'button';
    button.addEventListener('click', () => {
      window.MOApp.navigate('library/grimoire');
      claim(kind);
    });
    slot.root.append(button);
  }
  function attach(kind, host, source, controls) {
    if (!['desk', 'workspace'].includes(kind) || !trusted(source) || host.ownerDocument.defaultView !== source ||
        (controls && (kind !== 'desk' || controls === host || controls.ownerDocument.defaultView !== source)))
      throw new Error('Pracovný panel nie je dostupný z tohto okna.');
    const old = slots.get(kind);
    if (old?.host === host) { claim(kind); return; }
    release(kind);
    if (old) old.host.replaceChildren();
    old?.controlsRoot?.replaceChildren();
    const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
    shadow.replaceChildren();
    for (const file of ['styles.css', 'app.css', 'academy.css', 'desk.css', 'opus-theme.css']) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = new URL(file + '?v=workbench1', window.location.href).href;
      shadow.append(link);
    }
    const style = document.createElement('style');
    style.textContent = ':host{display:block;color:#e8e3d4;font:14px "Segoe UI",sans-serif;overflow:auto;background:#102c32} .page,.desk-page{padding:16px;margin:0;max-width:none} .page-header{flex-wrap:wrap} .page-title{font-size:25px} .mo-notebook{grid-template-columns:155px minmax(240px,1fr)} .mo-page-editor{padding:16px} .mo-kanban{min-width:650px} .desk-heading h1{font-size:24px} .desk-worktop{padding:0;background:#000} .desk-viewport{width:5800px;height:5800px;min-height:0;padding:0;max-width:none;resize:both;background:#000} .desk-sizer{margin:0} .desk-board{border-radius:0} .desk-paint,.desk-grid,.desk-items{width:100%;height:100%} .desk-heading,.desk-toolbar,.desk-selection-bar,.desk-footer,.desk-notice{max-width:100%;}';
    style.textContent += ' #desk-root[data-shared-surface]{position:relative;padding:0} .desk-shared-controls{position:absolute;z-index:8;right:0;top:0;width:50%;max-height:45vh;overflow:auto;background:#102c32ed} .desk-shared-controls .desk-heading{padding:8px;margin:0;gap:8px} .desk-shared-controls .desk-heading h1{font-size:16px} .desk-shared-controls .desk-toolbar{border-radius:0} .desk-shared-controls .desk-footer{padding:8px} #desk-root[data-shared-surface] .desk-worktop{border:0}';
    const root = document.createElement('div');
    shadow.append(style, root);
    let controlsRoot;
    if (controls) {
      const controlsShadow = controls.shadowRoot || controls.attachShadow({ mode: 'open' });
      controlsShadow.replaceChildren();
      for (const node of shadow.children) if (node !== root) controlsShadow.append(node.cloneNode(true));
      const controlsStyle = document.createElement('style');
      controlsStyle.textContent = ':host{display:block;background:transparent;overflow:visible;min-width:0;width:100%} .desk-shared-controls{position:static;width:100%;max-height:min(32vh,320px);overflow:auto;background:transparent} .desk-shared-controls [hidden]{display:none!important} .desk-heading>div:first-child{display:none} .desk-heading-actions{flex-direction:row;align-items:center;justify-content:space-between;width:100%} .desk-control-switches,.desk-control-common{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0} .desk-control-panel{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:6px 0} .desk-tool-group{flex-wrap:wrap;border:0;padding:0;max-width:100%} .desk-tool-group:first-child{width:auto;border:0;justify-content:flex-start} .desk-selection-bar{flex-wrap:wrap;width:100%;padding:8px} .desk-selection-label{max-width:100%;white-space:normal} .desk-selection-actions{flex-wrap:wrap} .desk-grid-menu,.desk-file-menu{padding:0;margin:0;width:100%} .desk-grid-menu>summary,.desk-file-menu>summary{display:none} .desk-grid-popover,.desk-file-menu>div{position:static;width:auto;min-width:0;max-width:none;box-shadow:none;margin:0} .desk-footer{flex-wrap:wrap;white-space:normal;padding:4px} .desk-notice{margin:4px 0} .desk-button:focus-visible{outline:2px solid #e7c77f;outline-offset:2px}';
      controlsStyle.textContent += ' .desk-page{padding:0;margin:0} .desk-shared-controls{max-height:none;overflow:visible} .desk-control-common .desk-tool-group .desk-button{flex-direction:row;min-height:28px;min-width:32px;padding:4px 8px;font-size:12px} .desk-shared-controls .desk-heading{padding:4px 0}';
      controlsRoot = document.createElement('div');
      controlsRoot.className = 'desk-page';
      if(controls.dataset.unifiedControls==='true')controlsRoot.dataset.unifiedControls='true';
      controlsShadow.append(controlsStyle, controlsRoot);
    }
    slots.set(kind, { host, root, controlsRoot, source, claimed: false });
    claim(kind);
  }
  function beforeRender(view) {
    if (view === 'desk') release('desk');
    if (view === 'workspace' || view === 'academy') release('workspace');
  }
  function afterRender(view) {
    if (view === 'library' && window.MOKnowledgeLibrary?.mode() === 'grimoire')
      for (const kind of slots.keys()) claim(kind);
  }
  function detach(kind, source) {
    const slot = slots.get(kind);
    if (!slot || slot.source !== source) return;
    release(kind); slot.host.replaceChildren(); slots.delete(kind);
  }
  function resize(kind, width, height, source) {
    const slot = slots.get(kind);
    if (kind !== 'desk' || !trusted(source) || slot?.source !== source || !slot.claimed ||
        !Number.isInteger(width) || !Number.isInteger(height) || width < 320 || height < 240 || width > 10000 || height > 10000)
      throw new Error('Neplatná veľkosť pracovného rozhrania.');
    const viewport = slot.root.querySelector('.desk-viewport');
    if (!viewport) throw new Error('Stôl sa ešte načítava. Skúste nastavenie po načítaní.');
    slot.root.dataset.panelWidth = String(width); slot.root.dataset.panelHeight = String(height);
    viewport.style.width = width + 'px'; viewport.style.height = height + 'px';
  }
  function destroy() {
    const sources = new Set([...slots.values()].map(slot => slot.source));
    for (const source of sources) source.dispatchEvent(new source.CustomEvent('mo-workbench-reset'));
    for (const [kind, slot] of slots) {
      engine(kind).embed(null); slot.host.replaceChildren(); slot.controlsRoot?.replaceChildren();
    }
    slots.clear();
  }
  function endInteraction(source) {
    if (!trusted(source) || slots.get('desk')?.source !== source) throw new Error('Stôl nie je dostupný z tohto okna.');
    window.MODesk.endInteraction();
  }
  function tools(value, category, source) {
    if (!trusted(source) || slots.get('desk')?.source !== source || !slots.get('desk')?.claimed) throw new Error('Stôl nie je dostupný z tohto okna.');
    if(value)window.MODesk.setBrush(value);
    if(category)window.MODesk.category(category);
  }
  window.MOGrimoireWorkbench = Object.freeze({ attach, detach, resize, endInteraction, tools, beforeRender, afterRender, destroy });
})();
