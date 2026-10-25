(function () {
  'use strict';
  var companion = null, owner = '', mode = '', opening = false, generation = 0, fallback = false;
  var A = function () { return window.MOApp; };
  function accountId() {
    var auth = window.MOAuth, account = auth && auth.getAccount();
    return auth && auth.isAuthenticated() && account ? account.id : '';
  }
  function supportsFloating() {
    return !!(window.documentPictureInPicture && typeof window.documentPictureInPicture.requestWindow === 'function');
  }
  function isOpen() { return !!companion && !companion.closed; }
  function asset() {
    var outfit = A().state.profile.equipped;
    var fragments = { rose: '#rose', forest: '#forest', midnight: '#cobalt' };
    return new URL('assets/wizard.svg' + (Object.hasOwn(fragments, outfit) ? fragments[outfit] : ''), window.location.href).href;
  }
  function controls() {
    if (!accountId()) return '';
    return '<section class="card mo-desktop-card" data-desktop-controls>' +
      '<div class="mo-desktop-preview" aria-hidden="true"><img src="' + A().esc(asset()) + '" alt="" width="98" height="124"></div>' +
      '<div class="mo-desktop-copy"><p class="eyebrow">MALÝ SPOLOČNÍK</p><h2>Čarodej na ploche</h2>' +
      '<p class="muted">Vezmi svojho čarodeja so sebou aj mimo hry. Okno môžeš presunúť a zmeniť jeho veľkosť.</p>' +
      '<p class="form-hint">V podporovanom prehliadači zostane nad ostatnými aplikáciami. Inak sa otvorí obyčajné okno. Kartu hry nechaj otvorenú.</p>' +
      '<div class="card-actions"><button type="button" class="btn primary" data-action="desktop-open"' + (opening ? ' disabled' : '') + '>' +
      A().icon('hat', 18) + '<span data-desktop-open-label>' + (opening ? 'Otváram…' : isOpen() ? 'Zobraziť čarodeja' : 'Zobraziť na ploche') + '</span></button>' +
      '<button type="button" class="btn secondary" data-action="desktop-close"' + (!isOpen() ? ' hidden' : '') + '>Zavrieť čarodeja</button>' +
      '<button type="button" class="btn secondary" data-action="desktop-popup"' + (!fallback ? ' hidden' : '') + '>Otvoriť obyčajné okno</button></div>' +
      '<p class="form-hint" data-desktop-status role="status">' + status() + '</p></div></section>';
  }
  function status() {
    if (opening) return 'Otváram okno čarodeja…';
    if (isOpen()) return mode === 'floating' ? 'Čarodej je v plávajúcom okne nad aplikáciami.' : 'Čarodej je v obyčajnom okne; nemusí zostať nad ostatnými aplikáciami.';
    return fallback ? 'Okno nie je otvorené. Skús ho otvoriť znova alebo použi obyčajné okno. Pri blokovaní povoľ vyskakovacie okná pre túto hru.' : 'Spustí sa až po kliknutí. Zavrieš ho krížikom alebo klávesom Esc.';
  }
  function updateControls() {
    document.querySelectorAll('[data-desktop-controls]').forEach(function (card) {
      var open = card.querySelector('[data-action="desktop-open"]');
      open.disabled = opening;
      card.querySelector('[data-desktop-open-label]').textContent = opening ? 'Otváram…' : isOpen() ? 'Zobraziť čarodeja' : 'Zobraziť na ploche';
      card.querySelector('[data-action="desktop-close"]').hidden = !isOpen();
      card.querySelector('[data-action="desktop-popup"]').hidden = !fallback || isOpen();
      card.querySelector('[data-desktop-status]').textContent = status();
      card.querySelector('.mo-desktop-preview img').src = asset();
    });
  }
  function close() {
    generation++; opening = false;
    var old = companion;
    companion = null; owner = ''; mode = '';
    if (old && !old.closed) old.close();
    updateControls();
  }
  function populate(target) {
    var doc = target.document;
    doc.documentElement.lang = 'sk';
    doc.title = 'Tvoj čarodej · Magnum Opus';
    var meta = doc.createElement('meta'); meta.name = 'viewport'; meta.content = 'width=device-width, initial-scale=1'; doc.head.appendChild(meta);
    var css = doc.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('desktop.css?v=0.4.4', window.location.href).href; doc.head.appendChild(css);
    doc.body.className = 'mo-desktop-window';
    doc.body.innerHTML = '<main class="mo-companion"><p class="mo-companion-brand">MAGNUM OPUS <span aria-hidden="true">✦</span></p>' +
      '<div class="mo-companion-scene"><span class="mo-companion-orbit" aria-hidden="true"></span><img class="mo-companion-wizard" width="170" height="216" alt="Tvoj čarodej"></div>' +
      '<h1 class="mo-companion-name"></h1><p class="mo-companion-motto">Malý krok. Veľké dielo.</p>' +
      '<div class="mo-companion-actions"><button type="button" data-companion-back>Späť do hry ↗</button><button type="button" data-companion-close>Zavrieť</button></div>' +
      '<p class="mo-companion-mode"></p></main>';
    doc.querySelector('[data-companion-back]').addEventListener('click', function () { window.focus(); });
    doc.querySelector('[data-companion-close]').addEventListener('click', close);
    doc.addEventListener('keydown', function (event) { if (event.key === 'Escape') { event.preventDefault(); close(); } });
    target.addEventListener('pagehide', function () {
      if (companion !== target) return;
      fallback = mode === 'floating';
      companion = null; owner = ''; mode = ''; updateControls();
    }, { once: true });
    sync();
  }
  function sync() {
    if (!companion) return;
    if (companion.closed) { fallback = mode === 'floating'; companion = null; owner = ''; mode = ''; return; }
    if (!accountId() || accountId() !== owner) { close(); return; }
    try {
      var doc = companion.document;
      doc.querySelector('.mo-companion-name').textContent = A().state.profile.name;
      doc.querySelector('.mo-companion-wizard').src = asset();
      doc.querySelector('.mo-companion-mode').textContent = mode === 'floating' ? 'Nad aplikáciami · karta hry zostáva otvorená' : 'Obyčajné okno · kartu hry nechaj otvorenú';
    } catch (_) {
      // A normal popup can be navigated elsewhere by the user; leave that page alone.
      companion = null; owner = ''; mode = '';
    }
  }
  async function open(ordinary) {
    var id = accountId();
    if (!id) return false;
    sync();
    if (isOpen()) { companion.focus(); return true; }
    if (opening) return false;
    opening = true;
    var ticket = ++generation, target = null, floating = !ordinary && supportsFloating();
    updateControls();
    try {
      // This call must precede any awaited action to retain the user's click gesture.
      target = floating ? await window.documentPictureInPicture.requestWindow({ width: 290, height: 410 }) :
        window.open('about:blank', '_blank', 'popup=yes,width=290,height=410,resizable=yes,scrollbars=yes');
      if (!target) throw new Error('POPUP_BLOCKED');
      if (ticket !== generation || accountId() !== id) { target.close(); return false; }
      if (target.closed) throw new Error('WINDOW_CLOSED');
      if (!floating) target.opener = null;
      companion = target; owner = id; mode = floating ? 'floating' : 'popup'; fallback = false;
      populate(target);
      target.focus();
      return true;
    } catch (_) {
      if (target && !target.closed) target.close();
      if (ticket === generation) {
        companion = null; owner = ''; mode = ''; fallback = true;
        A().toast(floating ? 'Plávajúce okno sa nepodarilo otvoriť. Môžeš skúsiť obyčajné okno.' : 'Povoľ vyskakovacie okná pre túto hru a skús to znova.');
      }
      return false;
    } finally {
      if (ticket === generation) { opening = false; updateControls(); }
    }
  }
  function afterRender() { sync(); updateControls(); }
  function destroy() { fallback = false; close(); }
  window.addEventListener('pagehide', destroy);
  window.MODesktop = {
    controls: controls, afterRender: afterRender, destroy: destroy, open: open,
    handleAction: function (action) {
      if (action === 'desktop-open' || action === 'desktop-popup') { void open(action === 'desktop-popup'); return true; }
      if (action === 'desktop-close') { close(); return true; }
      return false;
    }
  };
})();
