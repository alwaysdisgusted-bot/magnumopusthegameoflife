(function () {
  'use strict';

  const host = document.querySelector('#field-map-diagram');
  if (!host) return;
  host.innerHTML = `<div class="field-map-toolbar" role="group" aria-label="Pohľad na podmapu">
    <button type="button" class="quiet-button" data-map-action="out" aria-label="Oddialiť podmapu">−</button>
    <output aria-label="Priblíženie podmapy" aria-live="polite">100 %</output>
    <button type="button" class="quiet-button" data-map-action="in" aria-label="Priblížiť podmapu">+</button>
    <button type="button" class="quiet-button" data-map-action="fit">Celá podmapa</button>
    <button type="button" class="quiet-button" data-map-action="selection">Zamerať výber</button>
  </div>
  <label class="field-branch-label">Zamerať vetvu <select aria-label="Zamerať vetvu podmapy"></select></label>
  <div class="field-map-canvas" tabindex="0" role="group" aria-label="Priestorová pojmová mapa odboru" aria-describedby="field-map-help"><div class="field-map-world"></div></div>
  <p id="field-map-help" class="map-keyboard-help">Ťahaj mapu. Šípky posúvajú, +/− približujú, Home zobrazí celú podmapu. Ctrl + koliesko približuje k ukazovateľu. Tab prechádza uzly; Enter otvorí zdroje pojmu.</p>`;
  const canvas = host.querySelector('.field-map-canvas');
  const world = host.querySelector('.field-map-world');
  const output = host.querySelector('output');
  const branches = host.querySelector('select');
  const views = new Map();
  let current = null, signature = '', nodes = [], width = 860, height = 600;
  let view = { x: 0, y: 0, zoom: 1 }, drag = null, suppressClickUntil = 0, pendingFit = false;
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const fitZoom = () => Math.min(1, Math.max(1, canvas.clientWidth - 24) / width, Math.max(1, canvas.clientHeight - 24) / height);

  function update(next = view) {
    if (!current || !canvas.clientWidth || !canvas.clientHeight) return;
    const zoom = clamp(next.zoom, Math.min(0.2, fitZoom()), 2.5);
    const visibleWidth = canvas.clientWidth / zoom, visibleHeight = canvas.clientHeight / zoom;
    const x = width < visibleWidth ? (width - visibleWidth) / 2 : clamp(next.x, -24, width - visibleWidth + 24);
    const y = height < visibleHeight ? (height - visibleHeight) / 2 : clamp(next.y, -24, height - visibleHeight + 24);
    view = { x, y, zoom };
    world.style.transform = `translate(${-x * zoom}px, ${-y * zoom}px) scale(${zoom})`;
    output.textContent = `${Math.round(zoom * 100)} %`;
    host.querySelector('[data-map-action="out"]').disabled = zoom <= Math.min(0.2, fitZoom()) + 0.0001;
    host.querySelector('[data-map-action="in"]').disabled = zoom >= 2.4999;
    views.set(current.id, { ...view });
  }

  function fit() {
    endDrag();
    if (!canvas.clientWidth || !canvas.clientHeight) { pendingFit = true; return; }
    pendingFit = false;
    const zoom = fitZoom();
    update({ zoom, x: (width - canvas.clientWidth / zoom) / 2, y: (height - canvas.clientHeight / zoom) / 2 });
  }

  function refresh() {
    if (pendingFit) {
      if (!canvas.clientWidth || !canvas.clientHeight) return;
      pendingFit = false;
      update({ x: 0, y: -24, zoom: Math.min(1, Math.max(1, canvas.clientWidth - 24) / width) });
    } else update();
  }

  function zoomBy(factor, anchor = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }) {
    const zoom = clamp(view.zoom * factor, Math.min(0.2, fitZoom()), 2.5);
    const x = view.x + anchor.x / view.zoom - anchor.x / zoom;
    const y = view.y + anchor.y / view.zoom - anchor.y / zoom;
    update({ x, y, zoom });
  }

  function focusNode(node, readable = true) {
    if (!node) return;
    endDrag();
    const zoom = readable ? Math.max(view.zoom, Math.min(1, canvas.clientWidth / 420)) : view.zoom;
    update({ zoom, x: node.x + node.width / 2 - canvas.clientWidth / (2 * zoom), y: node.y + node.height / 2 - canvas.clientHeight / (2 * zoom) });
  }

  function selectedNode() {
    const selected = current?.selected;
    return selected && nodes.find(node => node.kind === 'term' && node.categoryId === selected.categoryId && node.term === selected.term);
  }

  function markSelected(selected) {
    if (!current) return;
    current.selected = selected;
    const selectedIndex = nodes.indexOf(selectedNode());
    world.querySelectorAll('[data-node]').forEach(button => {
      if (button.dataset.kind === 'term') button.setAttribute('aria-pressed', String(Number(button.dataset.node) === selectedIndex));
    });
  }

  function endDrag() {
    if (!drag) return;
    const previous = drag;
    drag = null;
    canvas.classList.remove('is-panning');
    if (previous.moved) suppressClickUntil = performance.now() + 300;
    if (canvas.hasPointerCapture(previous.id)) canvas.releasePointerCapture(previous.id);
  }

  function render(data) {
    const changedField = current?.id !== data.id;
    current = data;
    const nextSignature = JSON.stringify([data.id, data.name, data.categories]);
    if (nextSignature !== signature) {
      endDrag();
      signature = nextSignature;
      nodes = [];
      const edges = [];
      let top = 36;
      const categories = data.categories.map(category => {
        const laneHeight = Math.max(176, category.terms.length * 84 + 48);
        const node = { kind: 'category', categoryId: category.id, name: category.name, x: 250, y: top + laneHeight / 2 - 34, width: 180, height: 68 };
        top += laneHeight;
        return { category, node, start: top - laneHeight };
      });
      width = 860; height = Math.max(600, top + 36);
      const root = { kind: 'root', name: data.name, x: 24, y: height / 2 - 42, width: 180, height: 84 };
      nodes.push(root);
      categories.forEach(({ category, node, start }) => {
        nodes.push(node);
        edges.push([root, node]);
        const termNodes = category.terms.map((entry,index) => ({
          kind:'term',categoryId:category.id,term:entry.term,name:entry.term,description:entry.description,index,
          x:486,y:0,width:164,height:68,entry,
        }));
        const parentOf = term => term.entry.parent?.termId
          ? termNodes.find(item => item.entry.serverId === term.entry.parent.termId)
          : term.entry.parent?.term ? termNodes.find(item => item.term === term.entry.parent.term) : null;
        const visited = new Set();
        let row = 0;
        function append(term,parent,depth) {
          if (visited.has(term)) return;
          visited.add(term);
          term.x = 486 + depth * 200; term.y = start + 24 + row++ * 84;
          width = Math.max(width,term.x + term.width + 36);
          nodes.push(term); edges.push([parent,term]);
          termNodes.filter(item => parentOf(item) === term).forEach(child => append(child,term,depth + 1));
        }
        termNodes.filter(term => !parentOf(term)).forEach(term => append(term,node,0));
        termNodes.filter(term => !visited.has(term)).forEach(term => append(term,node,0));
      });
      world.style.width = `${width}px`; world.style.height = `${height}px`;
      world.innerHTML = `<svg class="field-map-edges" width="${width}" height="${height}" aria-hidden="true">${edges.map(([a, b]) => `<path d="M ${a.x + a.width} ${a.y + a.height / 2} C ${a.x + a.width + 28} ${a.y + a.height / 2}, ${b.x - 28} ${b.y + b.height / 2}, ${b.x} ${b.y + b.height / 2}"/>`).join('')}</svg>` + nodes.map((node, index) => `<button type="button" class="field-graph-node field-graph-${node.kind}" data-node="${index}" data-kind="${node.kind}" style="left:${node.x}px;top:${node.y}px;width:${node.width}px;height:${node.height}px" title="${escape(node.name)}" aria-label="${escape(node.kind === 'term' ? `Zdroje pojmu ${node.name}` : node.name)}"><span>${escape(node.name)}</span>${node.kind === 'category' ? '<small>Podkategória · zamerať</small>' : node.kind === 'root' ? '<small>Odbor · celá mapa</small>' : '<small>Otvoriť zdroje →</small>'}</button>`).join('');
      const previousCategory = branches.value;
      branches.innerHTML = '<option value="">Vyber podkategóriu…</option>' + data.categories.map(category => `<option value="${escape(category.id)}">${escape(category.name)}</option>`).join('');
      branches.value = !changedField && data.categories.some(category => category.id === previousCategory) ? previousCategory : '';
      view = views.get(data.id) || { x: 0, y: 0, zoom: 1 };
      pendingFit = !views.has(data.id);
    }
    markSelected(data.selected);
    refresh();
  }

  host.addEventListener('click', event => {
    const action = event.target.closest('[data-map-action]')?.dataset.mapAction;
    if (action === 'in') zoomBy(1.4);
    if (action === 'out') zoomBy(1 / 1.4);
    if (action === 'fit') fit();
    if (action === 'selection') focusNode(selectedNode() || nodes.find(node => node.categoryId === branches.value) || nodes[0]);
    const button = event.target.closest('[data-node]');
    if (!button) return;
    const node = nodes[Number(button.dataset.node)];
    if (node?.kind === 'term') current.onTerm(node.categoryId, node.index);
    else if (node?.kind === 'category') { branches.value = node.categoryId; focusNode(node); }
    else if (node?.kind === 'root') fit();
  });
  branches.addEventListener('change', () => focusNode(nodes.find(node => node.kind === 'category' && node.categoryId === branches.value)));
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || drag) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, view: { ...view }, moved: false };
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (!drag.moved) { drag.moved = true; canvas.setPointerCapture(event.pointerId); canvas.classList.add('is-panning'); }
    event.preventDefault();
    update({ ...drag.view, x: drag.view.x - dx / drag.view.zoom, y: drag.view.y - dy / drag.view.zoom });
  });
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('lostpointercapture', endDrag);
  canvas.addEventListener('pointerleave', () => { if (drag && !drag.moved) endDrag(); });
  canvas.addEventListener('click', event => {
    if (event.detail && performance.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  canvas.addEventListener('wheel', event => {
    if ((!event.ctrlKey && !event.metaKey) || !event.deltaY) return;
    event.preventDefault(); endDrag();
    const bounds = canvas.getBoundingClientRect();
    zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15, { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  }, { passive: false });
  canvas.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[event.key]) {
      event.preventDefault();
      const [x, y] = arrows[event.key];
      update({ ...view, x: view.x + x * canvas.clientWidth / view.zoom * .12, y: view.y + y * canvas.clientHeight / view.zoom * .12 });
    } else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(1.4); }
    else if (event.key === '-') { event.preventDefault(); zoomBy(1 / 1.4); }
    else if (event.key === 'Home' || event.key === '0') { event.preventDefault(); fit(); }
  });
  canvas.addEventListener('focusin', event => {
    if (!event.target.matches(':focus-visible')) return;
    const button = event.target.closest('[data-node]');
    if (!button) return;
    const node = nodes[Number(button.dataset.node)];
    if (node.x < view.x || node.x + node.width > view.x + canvas.clientWidth / view.zoom || node.y < view.y || node.y + node.height > view.y + canvas.clientHeight / view.zoom) focusNode(node, false);
  });
  window.addEventListener('blur', endDrag);
  new ResizeObserver(refresh).observe(canvas);
  window.MOKnowledgeFieldMap = Object.freeze({ render, markSelected, focusSelection: () => focusNode(selectedNode()), focusCategory: id => focusNode(nodes.find(node => node.kind === 'category' && node.categoryId === id)) });
})();
