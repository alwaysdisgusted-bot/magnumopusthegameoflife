(function () {
  'use strict';
  var MINUTE = 60000, PREFIX = 'magnum-opus:hydration:', accountId = '', enabled = true, nextAt = 0;
  var timer = null, hideTimer = null, banner = null, listening = false, storageAvailable = true;
  var lastInteraction = 0, previousPosition = -1, currentView = '', pointers = new Set();
  var positions = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
  var messages = ['Malá prestávka na dúšok vody?', 'Máš poruke vodu? Môžeš si dať dúšok.', 'Chvíľka pre teba. Dáš si dúšok vody?'];
  var app = function () { return window.MOApp; };
  function userId() {
    var auth = window.MOAuth, user = auth && auth.getAccount && auth.getAccount();
    return auth && auth.isAuthenticated() && user && typeof user.id === 'string' ? user.id : '';
  }
  function delay() { return (20 + Math.random() * 20) * MINUTE; }
  function clearTimer() { if (timer !== null) clearTimeout(timer); timer = null; }
  function removeBanner() {
    if (hideTimer !== null) clearTimeout(hideTimer);
    hideTimer = null;
    if (banner) banner.remove();
    banner = null;
  }
  function preferences(raw) {
    try {
      var value = JSON.parse(raw || 'null');
      return { enabled: !value || value.enabled !== false, nextAt: value && Number.isFinite(value.nextAt) && value.nextAt > 0 ? value.nextAt : 0 };
    } catch { return { enabled: true, nextAt: 0 }; }
  }
  function readPreferences() {
    try {
      var value = preferences(localStorage.getItem(PREFIX + accountId));
      enabled = value.enabled; nextAt = value.nextAt;
    } catch { storageAvailable = false; }
  }
  function persist() {
    try { localStorage.setItem(PREFIX + accountId, JSON.stringify({ enabled: enabled, nextAt: nextAt })); }
    catch { storageAvailable = false; }
  }
  function syncAccount() {
    var id = userId();
    if (id !== accountId) {
      clearTimer(); removeBanner(); pointers.clear();
      accountId = id; enabled = true; nextAt = 0; storageAvailable = true; lastInteraction = 0;
      if (id) {
        readPreferences();
        // A new page session always starts gently, even if an old reminder was overdue.
        nextAt = Math.max(nextAt, Date.now() + delay());
        persist();
      }
    }
    return !!accountId;
  }
  function busy() {
    var active = document.activeElement;
    return document.hidden || !document.getElementById('main') || !!document.querySelector('dialog[open], [aria-modal="true"]') ||
      !!(active && active.closest && active.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) ||
      pointers.size > 0 || Date.now() - lastInteraction < 15000;
  }
  function placeBanner() {
    var main = document.getElementById('main');
    if (!banner || !main) return;
    var rect = main.getBoundingClientRect(), start = Math.max(0, rect.left), end = Math.min(window.innerWidth, rect.right);
    var width = Math.max(0, Math.min(286, end - start - 24));
    if (width < 180) { removeBanner(); return; }
    var right = previousPosition % 2 === 1, bottom = previousPosition > 1, mobileBar = document.querySelector('.mobile-bar');
    var headerBottom = mobileBar && mobileBar.getBoundingClientRect ? mobileBar.getBoundingClientRect().bottom : 0;
    banner.style.width = width + 'px';
    banner.style.left = (right ? end - width - 12 : start + 12) + 'px';
    banner.style.top = bottom ? 'auto' : Math.max(12, rect.top + 12, headerBottom + 12) + 'px';
    banner.style.bottom = bottom ? '16px' : 'auto';
  }
  function schedule(retry) {
    clearTimer();
    if (!accountId || !enabled || document.hidden) return;
    timer = setTimeout(tick, retry || Math.max(1, nextAt - Date.now()));
  }
  function show(preview) {
    if (!syncAccount() || !enabled || document.hidden) return false;
    var active = document.activeElement;
    if (document.querySelector('dialog[open], [aria-modal="true"]') ||
        (active && active.closest && active.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) || pointers.size > 0) return false;
    removeBanner();
    var position = Math.floor(Math.random() * positions.length);
    if (position === previousPosition) position = (position + 1) % positions.length;
    previousPosition = position;
    banner = document.createElement('aside');
    banner.id = 'mo-hydration-note';
    banner.className = 'mo-hydration-note mo-hydration-' + positions[position];
    banner.setAttribute('role', 'status'); banner.setAttribute('aria-live', 'polite');
    banner.innerHTML = '<button type="button" class="mo-hydration-close" data-action="hydration-dismiss" aria-label="Zavrieť pripomienku vody na 30 minút">×</button>' +
      '<span class="mo-hydration-drop" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3C10 7 5 12 5 16a7 7 0 0 0 14 0c0-4-5-9-7-13Z"/><path d="M8 16a4 4 0 0 0 4 4"/></svg></span>' +
      '<div><p class="mo-hydration-label">' + (preview ? 'UKÁŽKA PRIPOMIENKY' : 'MALÁ PRIPOMIENKA') + '</p><p class="mo-hydration-message">' + messages[Math.floor(Math.random() * messages.length)] + '</p>' +
      '<div class="mo-hydration-actions"><button type="button" data-action="hydration-dismiss">O 30 minút</button><button type="button" data-action="hydration-disable">Vypnúť</button></div></div>';
    document.getElementById('main').appendChild(banner); placeBanner();
    nextAt = Date.now() + delay(); persist(); schedule();
    hideTimer = setTimeout(function () {
      hideTimer = null;
      // Leave keyboard users time to choose a button without moving their focus.
      if (!(banner && banner.contains(document.activeElement))) removeBanner();
    }, 45000);
    return !!banner;
  }
  function tick() {
    timer = null;
    if (!syncAccount()) return;
    // Recheck the shared cooldown before showing, including changes from another tab.
    readPreferences();
    if (!enabled || document.hidden) { removeBanner(); return; }
    if (nextAt > Date.now()) { schedule(); return; }
    if (busy()) { schedule(MINUTE); return; }
    if (!show(false)) schedule(MINUTE);
  }
  function controls() {
    if (!syncAccount()) return '';
    return '<section class="card mo-hydration-settings"><p class="eyebrow">CHVÍĽKA PRE SEBA</p><h2>Pripomienka vody</h2>' +
      '<p class="muted">Počas používania hry sa občas objaví malý lístok na rôznych miestach. Prvý príde po 20–40 minútach; pri písaní alebo kreslení počká.</p>' +
      '<div class="card-actions"><button type="button" class="btn secondary" data-action="hydration-toggle" aria-pressed="' + enabled + '">Pripomienky: ' + (enabled ? 'zapnuté' : 'vypnuté') + '</button>' +
      '<button type="button" class="btn secondary" data-action="hydration-preview"' + (enabled ? '' : ' disabled') + '>Pozrieť ukážku</button></div>' +
      '<p class="form-hint">' + (storageAvailable ? 'Nastavenie platí pre tento účet len v tomto prehliadači. Nie je súčasťou hernej zálohy.' : 'Prehliadač nepovolil uloženie. Nastavenie platí len v tomto otvorenom okne.') + '</p></section>';
  }
  function handleAction(action) {
    if (action.indexOf('hydration-') !== 0) return false;
    if (!syncAccount()) return true;
    if (action === 'hydration-dismiss') {
      removeBanner(); nextAt = Date.now() + 30 * MINUTE; persist(); schedule();
    } else if (action === 'hydration-preview') {
      if (enabled && !show(true)) app().toast('Ukážku otvor po zatvorení formulára alebo dokončení písania.');
    } else if (action === 'hydration-toggle' || action === 'hydration-disable') {
      enabled = action === 'hydration-toggle' ? !enabled : false;
      removeBanner(); clearTimer();
      if (enabled) nextAt = Date.now() + delay();
      persist(); schedule(); app().render();
      if (!enabled) app().toast('Pripomienky vody sú vypnuté. Zapneš ich v Nastaveniach.');
    }
    return true;
  }
  function interaction(event) {
    lastInteraction = Date.now();
    if (event.type === 'pointerdown') pointers.add(event.pointerId);
    if (banner && event.target && event.target.closest && event.target.closest('input, textarea, select, [contenteditable], .desk-board')) removeBanner();
  }
  function pointerEnd(event) { pointers.delete(event.pointerId); lastInteraction = Date.now(); }
  function visibility() {
    clearTimer(); removeBanner(); pointers.clear();
    if (!syncAccount() || document.hidden || !enabled) return;
    if (nextAt <= Date.now()) { nextAt = Date.now() + delay(); persist(); }
    schedule();
  }
  function storage(event) {
    if (!syncAccount() || event.key !== PREFIX + accountId) return;
    var value = preferences(event.newValue);
    enabled = value.enabled; nextAt = Math.max(value.nextAt, Date.now() + MINUTE);
    removeBanner(); schedule();
    if (currentView === 'settings') app().render();
  }
  function listen() {
    if (listening) return; listening = true;
    ['pointerdown', 'keydown', 'input', 'focusin'].forEach(function (type) { document.addEventListener(type, interaction, true); });
    ['pointerup', 'pointercancel'].forEach(function (type) { document.addEventListener(type, pointerEnd, true); });
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('storage', storage); window.addEventListener('resize', placeBanner);
  }
  function afterRender(view) {
    if (currentView !== view) removeBanner();
    currentView = view;
    if (!syncAccount()) return;
    listen();
    // Normal renders replace the main contents. A nudge never needs to interrupt a redraw.
    if (banner && !banner.isConnected) removeBanner();
    if (!enabled || document.hidden) { clearTimer(); removeBanner(); return; }
    if (timer === null) schedule();
  }
  function destroy() {
    clearTimer(); removeBanner(); pointers.clear(); accountId = ''; enabled = true; nextAt = 0; currentView = '';
    if (!listening) return; listening = false;
    ['pointerdown', 'keydown', 'input', 'focusin'].forEach(function (type) { document.removeEventListener(type, interaction, true); });
    ['pointerup', 'pointercancel'].forEach(function (type) { document.removeEventListener(type, pointerEnd, true); });
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('storage', storage); window.removeEventListener('resize', placeBanner);
  }
  window.MOHydration = { controls: controls, afterRender: afterRender, handleAction: handleAction, destroy: destroy, pause: removeBanner };
})();
