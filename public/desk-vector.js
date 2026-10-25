(function () {
  'use strict';
  const ns = 'http://www.w3.org/2000/svg';
  function node(doc, tag, attrs) {
    const el = doc.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    return el;
  }
  function paint(svg, state, preview) {
    const doc = svg.ownerDocument;
    svg.setAttribute('viewBox', `0 0 ${state.width} ${state.height}`);
    svg.replaceChildren();
    const defs = node(doc, 'defs', {});
    let layer = node(doc, 'g', {});
    svg.append(defs, layer);
    for (const s of preview ? [...state.strokes, preview] : state.strokes) {
      const a = s.points[0], b = s.points.at(-1), dot = s.points.length === 1;
      const attrs = { fill: 'none', stroke: s.color, 'stroke-width': s.size, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
      const shape = dot ? node(doc, 'circle', { ...attrs, cx: a.x, cy: a.y, r: s.size / 2, fill: s.color, stroke: 'none' }) :
        s.tool === 'rect' ? node(doc, 'rect', { ...attrs, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }) :
        s.tool === 'ellipse' ? node(doc, 'ellipse', { ...attrs, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, rx: Math.abs(a.x - b.x) / 2, ry: Math.abs(a.y - b.y) / 2 }) :
        node(doc, 'polyline', { ...attrs, points: (s.tool === 'line' ? [a, b] : s.points).map(p => p.x + ',' + p.y).join(' ') });
      if (s.tool !== 'eraser') { layer.append(shape); continue; }
      const id = 'desk-erase-' + crypto.randomUUID();
      const mask = node(doc, 'mask', { id, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: state.width, height: state.height });
      mask.append(node(doc, 'rect', { width: state.width, height: state.height, fill: '#ffffff' }));
      shape.setAttribute('stroke', dot ? 'none' : '#000000'); shape.setAttribute('fill', dot ? '#000000' : 'none');
      mask.append(shape); defs.append(mask); layer.setAttribute('mask', `url(#${id})`);
      const next = node(doc, 'g', {});
      layer.replaceWith(next); next.append(layer); layer = next;
    }
  }
  window.MODeskVector = Object.freeze({ paint });
})();
