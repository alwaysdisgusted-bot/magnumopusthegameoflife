(function () {
  'use strict';

  const tree = document.querySelector('#tree');
  const zoomIn = document.querySelector('#map-zoom-in');
  const zoomOut = document.querySelector('#map-zoom-out');
  const label = document.querySelector('#map-zoom-level');
  if (!tree || !zoomIn || !zoomOut || !label) return;

  const WIDTH = 700, HEIGHT = 740, MAX_ZOOM = 4;
  let view = { x: 0, y: 0, width: WIDTH, height: HEIGHT };
  let drag = null, suppressClickUntil = 0;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function update(next) {
    view = {
      width: next.width, height: next.height,
      x: clamp(next.x, 0, WIDTH - next.width),
      y: clamp(next.y, 0, HEIGHT - next.height),
    };
    tree.setAttribute('viewBox', `${view.x} ${view.y} ${view.width} ${view.height}`);
    const zoom = WIDTH / view.width;
    label.textContent = `${Math.round(zoom * 100)} %`;
    zoomIn.disabled = zoom >= MAX_ZOOM - 0.001;
    zoomOut.disabled = zoom <= 1.001;
  }

  function zoomBy(factor, anchor = { x: view.x + view.width / 2, y: view.y + view.height / 2 }) {
    const zoom = clamp(WIDTH / view.width * factor, 1, MAX_ZOOM);
    const width = WIDTH / zoom, height = HEIGHT / zoom;
    const ratio = width / view.width;
    update({ x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio, width, height });
  }

  function endDrag() {
    if (!drag) return;
    const previous = drag;
    drag = null;
    tree.classList.remove('is-panning');
    if (previous.moved) suppressClickUntil = performance.now() + 300;
    if (tree.hasPointerCapture(previous.id)) tree.releasePointerCapture(previous.id);
  }

  function reset() {
    endDrag();
    update({ x: 0, y: 0, width: WIDTH, height: HEIGHT });
  }

  zoomIn.addEventListener('click', () => zoomBy(1.4));
  zoomOut.addEventListener('click', () => zoomBy(1 / 1.4));
  tree.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || drag) return;
    const matrix = tree.getScreenCTM();
    if (!matrix || !matrix.a || !matrix.d) return;
    drag = { id: event.pointerId, clientX: event.clientX, clientY: event.clientY, view: { ...view }, matrix, moved: false };
  });
  tree.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.clientX, dy = event.clientY - drag.clientY;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      tree.setPointerCapture(event.pointerId);
      tree.classList.add('is-panning');
    }
    event.preventDefault();
    update({ ...drag.view, x: drag.view.x - dx / drag.matrix.a, y: drag.view.y - dy / drag.matrix.d });
  });
  tree.addEventListener('pointerup', endDrag);
  tree.addEventListener('pointercancel', endDrag);
  tree.addEventListener('lostpointercapture', endDrag);
  tree.addEventListener('pointerleave', () => { if (drag && !drag.moved) endDrag(); });
  // A drag beginning on a node must never activate that node on release.
  tree.addEventListener('click', event => {
    if (event.detail && performance.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  tree.addEventListener('wheel', event => {
    if ((!event.ctrlKey && !event.metaKey) || !event.deltaY) return;
    event.preventDefault();
    endDrag();
    const matrix = tree.getScreenCTM();
    if (!matrix) return;
    const point = tree.createSVGPoint();
    point.x = event.clientX; point.y = event.clientY;
    const anchor = point.matrixTransform(matrix.inverse());
    zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15, anchor);
  }, { passive: false });
  tree.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[event.key]) {
      event.preventDefault();
      const [x, y] = arrows[event.key];
      update({ ...view, x: view.x + x * view.width * 0.12, y: view.y + y * view.height * 0.12 });
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault(); zoomBy(1.4);
    } else if (event.key === '-') {
      event.preventDefault(); zoomBy(1 / 1.4);
    } else if (event.key === 'Home' || event.key === '0') {
      event.preventDefault(); reset();
    }
  });
  tree.addEventListener('focusin', event => {
    if (!event.target.matches(':focus-visible')) return;
    const circle = event.target.closest('.tree-node')?.querySelector('circle');
    if (!circle) return;
    const x = circle.cx.baseVal.value, y = circle.cy.baseVal.value, radius = circle.r.baseVal.value;
    if (x - radius < view.x || x + radius > view.x + view.width || y - radius < view.y || y + radius > view.y + view.height) {
      update({ ...view, x: x - view.width / 2, y: y - view.height / 2 });
    }
  });
  window.addEventListener('blur', endDrag);
  window.MOKnowledgeViewport = Object.freeze({ reset });
  reset();
})();
