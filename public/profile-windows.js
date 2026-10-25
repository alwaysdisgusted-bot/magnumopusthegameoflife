(function () {
  'use strict';
  const avatar = document.querySelector('#avatar');
  if (!avatar) return;
  const brand = document.querySelector('.village-crown .brand');
  const brandLabel = brand?.getAttribute('aria-label');
  const buildingViews = new Set(['library', 'gym', 'gallery', 'farm', 'shop', 'challenges', 'bank', 'calendar', 'profile', 'academy', 'workspace', 'quotes', 'desk', 'study', 'knowledge', 'notes', 'hall', 'mail']);
  let currentView = window.location?.hash.slice(1) || 'village';
  const inBuilding = () => buildingViews.has(currentView.split('/')[0]);
  const places = [
    ['library', 'Knižnica', 'Príbehy a poznanie', 45, 20],
    ['gym', 'Posilňovňa', 'Sila malých krokov', 24, 29],
    ['gallery', 'Galéria', 'Miesto pre tvorivosť', 79, 27],
    ['farm', 'Farma', 'Tvoji spoločníci', 91, 52],
    ['shop', 'Obchod', 'Čarovné maličkosti', 14, 58],
    ['bank', 'Banka', 'Tvoje úspory', 77, 76],
    ['meditation', 'Meditácia', 'Chvíľa pod stromom', 59, 48],
    ['challenges', 'Denné výzvy', 'Ďalší malý krok', 46, 48],
    ['calendar', 'Kalendár', 'Rytmus tvojich dní', 52, 76],
    ['profile', 'Môj dom', 'Profil a šatník', 33, 83]
  ];
  function windowArt(view, x, y) {
    const imageWidth = 780, imageHeight = imageWidth * 1429 / 2560;
    const imageX = Math.min(23, Math.max(157 - imageWidth, 90 - x * imageWidth / 100));
    const imageY = Math.min(33, Math.max(229 - imageHeight, 139 - y * imageHeight / 100));
    return `<svg class="village-window-art" viewBox="0 0 180 254" aria-hidden="true" focusable="false">
      <defs><clipPath id="village-window-${view}"><path d="M26 226V111Q26 65 90 24Q154 65 154 111V226Z"/></clipPath>
      <linearGradient id="village-stone-${view}" x2="1" y2="1"><stop stop-color="#e0b996"/><stop offset=".46" stop-color="#b78d6c"/><stop offset="1" stop-color="#705b50"/></linearGradient></defs>
      <path class="window-shadow" d="M12 235V110Q12 52 90 5Q168 52 168 110V235Z" fill="#342e2d"/>
      <g clip-path="url(#village-window-${view})"><image href="assets/village-current.jpg" x="${imageX}" y="${imageY}" width="${imageWidth}" height="${imageHeight}"/>
      <path d="M26 226V111Q26 65 90 24Q154 65 154 111V226Z" fill="#182a36" opacity=".08"/></g>
      <path d="M13 235V111Q13 56 90 6Q167 56 167 111V235H151V111Q151 72 90 30Q29 72 29 111V235Z" fill="url(#village-stone-${view})" stroke="#56483f" stroke-width="1.3"/>
      <path d="M12 111L30 114M17 84L36 91M30 59L47 71M50 35L64 51M72 17L80 36M90 6V30M108 17L100 36M130 35L116 51M150 59L133 71M163 84L144 91M168 111L150 114M13 143H29M13 175H29M13 207H29M151 143H167M151 175H167M151 207H167" fill="none" stroke="#725d50" stroke-width="2"/>
      <path d="M24 228V111Q24 67 90 26Q156 67 156 111V228Z" fill="none" stroke="#29343a" stroke-width="7"/>
      <g fill="none" stroke="#29343a" stroke-width="3.2"><path d="M90 228V122Q90 88 49 75M90 122Q90 88 131 75M27 136Q41 106 58 119Q75 132 75 158M153 136Q139 106 122 119Q105 132 105 158M90 122Q70 92 63 95M90 122Q110 92 117 95"/></g>
      <path d="M23 219H157V231H23Z" fill="#394146"/><path d="M8 232H172L178 241H2Z" fill="#c3a78b" stroke="#625344" stroke-width="1.5"/>
      <path d="M2 241H178V248H2Z" fill="#79624f"/><path d="M8 249H172" stroke="#c8a88a" stroke-width="3"/>
      <g fill="#8c9190"><circle cx="36" cy="225" r="1.4"/><circle cx="57" cy="225" r="1.4"/><circle cx="78" cy="225" r="1.4"/><circle cx="101" cy="225" r="1.4"/><circle cx="123" cy="225" r="1.4"/><circle cx="144" cy="225" r="1.4"/></g>
    </svg>`;
  }
  const panel = document.createElement('section');
  panel.id = 'profile-windows';
  panel.className = 'profile-windows';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Okná do tvojej dedinky');
  panel.innerHTML = `<div class="profile-windows-heading"><p>OKNÁ DO TVOJEJ DEDINKY</p><button class="profile-windows-close" type="button" aria-label="Zavrieť okná dedinky">×</button></div>
    <nav class="profile-windows-grid" aria-label="Budovy dedinky">${places.map(([view, label, subtitle, x, y], index) => `<button type="button" class="village-window" style="--window-index:${index}" data-action="navigate" data-view="${view}" aria-label="${label}">${windowArt(view, x, y)}<strong>${label}</strong><span>${subtitle}</span></button>`).join('')}</nav>`;
  document.body.appendChild(panel);
  avatar.setAttribute('aria-controls', panel.id);
  avatar.setAttribute('aria-expanded', 'false');
  let timer, suppressFocus = false, triggerHovered = false, suppressHover = false;
  function setTriggerHovered(hovered) {
    triggerHovered = hovered;
    const classes = document.body.classList;
    if (hovered && !classes.contains('profile-trigger-hovered')) classes.add('profile-trigger-hovered');
    if (!hovered && classes.contains('profile-trigger-hovered')) classes.remove('profile-trigger-hovered');
  }
  function position() {
    const viewportWidth = document.documentElement?.clientWidth || window.innerWidth;
    const sidebar = document.querySelector('#sidebar');
    const edge = window.innerWidth > 760 ? (sidebar?.getBoundingClientRect().right || 260) : 0;
    const top = window.innerWidth <= 760 ? 112 : 12;
    panel.style.width = Math.max(240, viewportWidth - edge - 24) + 'px';
    panel.style.left = edge + 12 + 'px';
    panel.style.top = top + 'px';
    panel.style.maxHeight = Math.max(60, window.innerHeight - top - 12) + 'px';
  }
  function open() {
    clearTimeout(timer);
    if (!inBuilding() || document.body.classList.contains('auth-locked') || (window.innerWidth <= 760 && !document.body.classList.contains('menu-open'))) return false;
    if (!document.body.classList.contains('profile-windows-open')) document.body.classList.add('profile-windows-open');
    panel.hidden = false;
    avatar.setAttribute('aria-expanded', 'true');
    brand?.setAttribute('href', '#profile');
    brand?.setAttribute('aria-label', 'Otvoriť môj profil');
    position();
    return true;
  }
  function close(restoreFocus = false) {
    clearTimeout(timer);
    suppressHover = triggerHovered;
    panel.hidden = true;
    if (document.body.classList.contains('profile-windows-open')) document.body.classList.remove('profile-windows-open');
    avatar.setAttribute('aria-expanded', 'false');
    brand?.setAttribute('href', '#village');
    if (brandLabel) brand?.setAttribute('aria-label', brandLabel);
    if (restoreFocus) {
      suppressFocus = true;
      avatar.focus({preventScroll:true});
      suppressFocus = false;
    }
  }
  function leave() {
    clearTimeout(timer);
    if (!panel.contains(document.activeElement) && document.activeElement !== avatar && !brand?.contains(document.activeElement)) timer = setTimeout(() => close(), 650);
  }
  function leaveTrigger(event) {
    if (!avatar.contains(event.relatedTarget) && !brand?.contains(event.relatedTarget)) { setTriggerHovered(false); suppressHover = false; }
    leave();
  }
  avatar.addEventListener('pointerenter', event => {
    if (event.pointerType !== 'touch' && window.innerWidth > 760) { setTriggerHovered(true); if (!suppressHover) open(); }
  });
  avatar.addEventListener('pointerleave', leaveTrigger);
  avatar.addEventListener('focus', () => { if (!suppressFocus && (window.innerWidth > 760 || avatar.matches(':focus-visible'))) open(); });
  function navigateProfile() {
    close();
    if (!document.body.classList.contains('auth-locked')) window.MOApp?.navigate('profile');
  }
  avatar.addEventListener('click', navigateProfile);
  avatar.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' && open()) { event.preventDefault(); panel.querySelector('.village-window').focus(); }
    if (event.key === 'Tab' && !event.shiftKey && !panel.hidden) { event.preventDefault(); panel.querySelector('.village-window').focus(); }
  });
  panel.addEventListener('pointerenter', () => clearTimeout(timer));
  panel.addEventListener('pointerleave', leave);
  panel.addEventListener('focusin', () => clearTimeout(timer));
  brand?.addEventListener('pointerenter', () => { if (!panel.hidden) setTriggerHovered(true); clearTimeout(timer); });
  brand?.addEventListener('pointerleave', leaveTrigger);
  brand?.addEventListener('focus', () => clearTimeout(timer));
  brand?.addEventListener('click', event => {
    if (!panel.hidden) {
      event.preventDefault();
      event.stopPropagation();
      navigateProfile();
    } else close();
  });
  panel.querySelector('.profile-windows-close').addEventListener('click', () => close(true));
  panel.addEventListener('click', event => {
    if (event.target.closest('[data-view]')) { close(); document.querySelector('#main')?.focus({preventScroll:true}); }
  });
  document.addEventListener('pointerdown', event => {
    if (!panel.hidden && !panel.contains(event.target) && !avatar.contains(event.target) && !brand?.contains(event.target)) close();
  });
  document.addEventListener('focusin', event => {
    if (!panel.hidden && !panel.contains(event.target) && !avatar.contains(event.target) && !brand?.contains(event.target)) close();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); event.stopImmediatePropagation(); close(true); }
  }, true);
  window.addEventListener('resize', () => {
    if (window.innerWidth <= 760 && !document.body.classList.contains('menu-open')) close();
    else if (!panel.hidden) position();
  });
  function afterRender(nextView) {
    const changed = currentView !== nextView;
    currentView = nextView;
    if (changed || !inBuilding()) close();
  }
  window.MOProfileWindows = Object.freeze({afterRender});
  afterRender(currentView);
  window.addEventListener('hashchange', () => { afterRender(window.location.hash.slice(1) || 'village'); close(); });
  new MutationObserver(() => {
    if (document.body.classList.contains('auth-locked') || (window.innerWidth <= 760 && !document.body.classList.contains('menu-open'))) close();
  }).observe(document.body, {attributes:true,attributeFilter:['class']});
}());
