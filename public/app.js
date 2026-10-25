(() => {
  'use strict';
  const M = window.MOModel;
  const LEGACY_KEY = 'magnum-opus:v1';
  let KEY = null, legacyState = null;
  const views = ['village','library','gym','meditation','gallery','farm','shop','challenges','bank','calendar','profile','settings','academy','workspace','quotes','desk','study','knowledge','notes','hall','mail'];
  const $ = s => document.querySelector(s);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paths = {
    home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
    coin:'<ellipse cx="12" cy="7" rx="8" ry="4"/><path d="M4 7v5c0 2 4 4 8 4s8-2 8-4V7M4 12v5c0 2 4 4 8 4s8-2 8-4v-5"/>',
    spark:'<path d="m12 2 2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8Z"/>',
    book:'<path d="M12 6C9 3 5 3 2 4v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-3-1-7-1-10 2Zm0 0v15"/>',
    dumbbell:'<path d="m7 7 10 10M4 5 2 7l5 5 2-2m6 4 2-2 5 5-2 2M7 2 2 7m20 10-5 5M5 4l3-3 5 5-3 3m4 5 3-3 5 5-3 3"/>',
    tree:'<path d="m12 2 6 7h-3l5 7h-6v6h-4v-6H4l5-7H6Z"/>',
    palette:'<path d="M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 1-4c-2-1-1-3 1-3h2a4 4 0 0 0 4-4c0-4-5-7-10-7Z"/><circle cx="7" cy="10" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7" r="1"/>',
    paw:'<ellipse cx="12" cy="16" rx="6" ry="5"/><ellipse cx="4" cy="9" rx="2" ry="3"/><ellipse cx="9" cy="5" rx="2" ry="3"/><ellipse cx="15" cy="5" rx="2" ry="3"/><ellipse cx="20" cy="9" rx="2" ry="3"/>',
    shop:'<path d="M3 10V7l2-4h14l2 4v3M4 10v11h16V10M9 21v-7h6v7M2 10h20M8 3l-1 7m9-7 1 7"/>',
    bank:'<path d="m2 8 10-6 10 6H2Zm2 3v8m5-8v8m6-8v8m5-8v8M2 22h20M2 19h20"/>',
    academy:'<path d="m2 8 10-5 10 5-10 5L2 8Zm4 3v7c4 3 8 3 12 0v-7M22 8v9"/>',
    flask:'<path d="M9 3h6M10 3v6L4 19a1.4 1.4 0 0 0 1.2 2h13.6A1.4 1.4 0 0 0 20 19L14 9V3M7 14h10"/><circle cx="11" cy="17" r=".7"/>',
    mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
    calendar:'<rect x="3" y="5" width="18" height="17" rx="2"/><path d="M7 2v6m10-6v6M3 11h18m-13 5h2m4 0h2"/>',
    check:'<path d="m5 12 4 4L20 5"/>',plus:'<path d="M12 4v16M4 12h16"/>',
    edit:'<path d="m16 3 5 5-12 12-6 1 1-6L16 3Zm-2 2 5 5"/>',arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
    settings:'<path d="m10 2-1 3-3 1-3-1-2 4 3 2v3l-3 2 2 4 3-1 3 1 1 3h4l1-3 3-1 3 1 2-4-3-2v-3l3-2-2-4-3 1-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
    download:'<path d="M12 2v13m-5-5 5 5 5-5M3 16v5h18v-5"/>',upload:'<path d="M12 16V3m-5 5 5-5 5 5M3 16v5h18v-5"/>',
    search:'<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',close:'<path d="m5 5 14 14M19 5 5 19"/>',
    hat:'<path d="M3 18c4-1 5-6 7-15l5 6 3 9M2 18c4-3 16-3 20 0-1 5-19 5-20 0ZM8 14l9 1"/>',star:'<path d="m12 2 3 7 7 1-5 5 1 7-6-4-6 4 1-7-5-5 7-1Z"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 3"/>',trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>'
  };
  function icon(name, size=20) { return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.spark}</svg>`; }
  const routeView = route => /^library\/(books|grimoire|tree)$/.test(route) ? 'library' : views.includes(route) ? route : null;
  let state, recovery = '', view = routeView(location.hash.slice(1)) || 'village';
  let bookSearch = '', bookTag = '', exerciseSearch = '', modalCallback = null, toastTimer, externalChange = false, welcomeDismissed = false;
  state = M.createState();
  try { const raw = localStorage.getItem(LEGACY_KEY); legacyState = raw ? M.validateState(JSON.parse(raw)) : null; }
  catch (_) { /* Preserve the original browser save for manual recovery. */ }

  function toast(message) { const el=$('#toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),4200); }
  function assertWritable() {
    if (!KEY || !window.MOAuth.isAuthenticated()) throw new Error('Najprv sa prihlás do svojho čarodejníckeho účtu.');
    if (externalChange) throw new Error('Hra sa zmenila v inom okne. Exportuj aktuálnu hru alebo načítaj uloženú verziu pred ďalšou úpravou.');
  }
  function commit(mutator, message, options = {}) {
    assertWritable();
    if (recovery) throw new Error('Najprv obnov zálohu alebo vyrieš poškodené uloženie v Nastaveniach.');
    const draft=JSON.parse(JSON.stringify(state)); const result=mutator(draft); const clean=M.validateState(draft);
    try { localStorage.setItem(KEY,JSON.stringify(clean)); } catch { throw new Error('Údaje sa nepodarilo uložiť. Exportuj zálohu; pri obálke skús menší obrázok.'); }
    state=clean; window.MOAuth.queueSave(clean);
    if(options.preserveView){$('#coin-count').textContent=M.balance(state);window.MOLearning?.afterRender();}
    else render();
    if(message)toast(message); return {ok:true,result};
  }
  function closeMenu() { document.body.classList.remove('menu-open'); $('#mobile-toggle')?.setAttribute('aria-expanded','false'); }
  function navigate(next) { const target=routeView(next); if(!target)return; view=target; if(location.hash!==`#${next}`)history.pushState(null,'',`#${next}`); closeMenu(); render(); $('#main').scrollTop=0; }
  function openModal(title, html, onSubmit, options={}) {
    const dlg=$('#modal'); if(dlg.open)dlg.close();
    $('#modal-title').textContent=title; $('#modal-body').innerHTML=html+'<p class="form-error" id="modal-error" role="alert"></p>';
    const save=$('#modal-save'); save.textContent=options.submitLabel||'Uložiť'; save.hidden=!!options.readOnly; save.disabled=false;
    window.MOHydration.pause();
    modalCallback=onSubmit; dlg.showModal(); requestAnimationFrame(()=>$('#modal-body input, #modal-body select, #modal-body textarea, #modal-body button')?.focus());
  }
  const field=(label,name,value='',type='text',attrs='')=>`<div class="field"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${attrs}></div>`;
  const fold=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const progress=(current,total)=>`<div class="progress-track" role="progressbar" aria-label="Progres" aria-valuenow="${current}" aria-valuemin="0" aria-valuemax="${total}"><div class="progress-fill" style="width:${Math.min(100,current/Math.max(1,total)*100)}%"></div></div>`;
  const header=(eyebrow,title,subtitle,actions='')=>`<header class="page-header"><div><p class="eyebrow">${eyebrow}</p><h1 class="page-title">${title}</h1><p class="page-subtitle">${subtitle}</p></div><div class="toolbar">${actions}</div></header>`;
  const tagsHTML=tags=>tags.map(t=>`<button type="button" class="tag" data-action="filter-tag" data-tag="${esc(t)}">${esc(t)}</button>`).join('');
  function empty(title,text,action,label,ic='book') { return `<div class="empty-state"><div class="empty-icon">${icon(ic,42)}</div><h2>${title}</h2><p>${text}</p><button class="btn primary" data-action="${action}">${icon('plus')} ${label}</button></div>`; }
  function bookCover(book, cls='book-cover') { return book.cover ? `<img class="${cls}" src="${esc(book.cover)}" alt="Obálka: ${esc(book.title)}">` : `<div class="${cls} generated-cover"><span>MAGNUM<br>OPUS</span>${icon('book',42)}<strong>${esc(book.title)}</strong><small>${esc(book.author||'Moja knižnica')}</small></div>`; }
  function bookCards() {
    let books=state.books.filter(b=>(!bookSearch||fold(`${b.title} ${b.author} ${b.tags.join(' ')}`).includes(fold(bookSearch)))&&(!bookTag||b.tags.includes(bookTag)));
    if(!state.books.length)return empty('Každá kniha je nový svet.','Pridaj prvú knihu a premeň svoje čítanie na malé kroky vpred.','add-book','Pridať prvú knihu');
    if(!books.length)return `<div class="empty-state compact">${icon('search',36)}<h2>Nenašli sa žiadne knihy</h2><p>Skús iný názov, autora alebo tag.</p><button class="btn secondary" data-action="clear-book-search">Vymazať vyhľadávanie</button></div>`;
    return `<div class="grid two">${books.map(b=>`<article class="book-card"><button class="cover-button" data-action="book-detail" data-id="${b.id}" aria-label="Otvoriť knihu ${esc(b.title)}">${bookCover(b)}</button><div class="book-info"><p class="eyebrow">${b.current===b.total?'DOČÍTANÉ':'TVOJA KNIŽNICA'}</p><button class="title-button" data-action="book-detail" data-id="${b.id}"><h2 class="book-title">${esc(b.title)}</h2></button><p class="book-author">${esc(b.author||'Autor neuvedený')}</p><div class="tag-list">${tagsHTML(b.tags)}</div><div class="progress-meta"><span><b>${b.current}</b> / ${b.total} strán</span><span>${Math.round(b.current/b.total*100)} %</span></div>${progress(b.current,b.total)}<div class="card-actions"><button class="btn primary small" data-action="read-book" data-id="${b.id}" ${b.current===b.total?'disabled':''}>${icon('plus',16)} Zapísať čítanie</button><button class="icon-btn" data-action="edit-book" data-id="${b.id}" aria-label="Upraviť ${esc(b.title)}">${icon('edit',18)}</button></div></div></article>`).join('')}</div>`;
  }
  function library() {
    if(window.MOKnowledgeLibrary.mode()==='room')return `<section class="library-entrance opus-library" aria-labelledby="library-room-title"><header class="page-header"><div><p class="eyebrow">ALCHYMISTOVA KNIŽNICA</p><h1 class="page-title" id="library-room-title">Miesto pre tvoje poznanie.</h1><p class="page-subtitle">Otvor zdroj, nájdi súvislosť a pokračuj vo vlastnom veľkom diele.</p></div></header><nav class="opus-library-actions" aria-label="Miesta v Knižnici"><a class="opus-library-card" href="#library/books">${icon('book',36)}<span><strong>Knihy a fotografie</strong><small>Tvoje čítanie a obrazové zbierky</small></span></a><a class="opus-library-card" href="#library/grimoire">${icon('edit',36)}<span><strong>Grimoár</strong><small>Zdroje, vyhľadávanie a pracovný stôl</small></span></a><a class="opus-library-card" href="#library/tree">${icon('tree',36)}<span><strong>Mapa stromu</strong><small>Odbory, termíny a súvisiace dokumenty</small></span></a><a class="opus-library-card" href="#academy">${icon('academy',36)}<span><strong>Akadémia</strong><small>Tvoj existujúci priestor na štúdium</small></span></a></nav><p class="opus-library-foot">Tvoja súkromná knižnica. Všetko zostáva v tomto počítači.</p></section>`;
    if(window.MOKnowledgeLibrary.mode()!=='books')return '<div class="knowledge-library-placeholder" aria-hidden="true"></div>';
    const allTags=[...new Set(state.books.flatMap(b=>b.tags))];
    if(window.MOLibraryCategories.isActive())return `<section class="scene library"><div class="scene-inner">${header('CHRÁM ZVEDAVOSTI','Knižnica','Tvoje knihy, vlastné kategórie a fotografie na jednom mieste.')}${window.MOLibraryCategories.tabs()}${window.MOLibraryCategories.render()}</div></section>`;
    return `<section class="scene library"><div class="scene-inner">${header('CHRÁM ZVEDAVOSTI','Knižnica','Stránku po stránke. Myšlienku po myšlienke.',`<span class="balance-pill">${icon('coin')} ${state.reading.reward} kor. / ${state.reading.threshold} strán</span><button class="btn primary" data-action="add-book">${icon('plus')} Pridať knihu</button>`)}<div class="content-panel library-panel"><div class="library-tools"><div class="search-wrap">${icon('search')}<input class="search-field" id="book-search" type="search" placeholder="Hľadať názov, autora alebo tag…" aria-label="Hľadať knihy" value="${esc(bookSearch)}" autocomplete="off"></div><span class="muted">${state.books.length} ${state.books.length===1?'kniha':'kníh'} v tvojej knižnici</span></div>${allTags.length?`<div class="chips"><button class="chip ${!bookTag?'active':''}" data-action="filter-tag" data-tag="">Všetky</button>${allTags.map(t=>`<button class="chip ${bookTag===t?'active':''}" data-action="filter-tag" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>`:''}<div id="book-results">${bookCards()}</div></div><div class="scene-footer">${icon('spark',16)} Do ďalšej odmeny zostáva ${state.reading.threshold-state.reading.remainder} strán. Každý malý krok sa počíta.</div></div></section>`;
  }
  function exerciseCards() {
    const list=state.exercises.filter(e=>fold(e.name).includes(fold(exerciseSearch)));
    if(!state.exercises.length)return empty('Tvoje telo, tvoje tempo.','Pridaj vlastný cvik a nastav si odmenu za skutočný pohyb.','add-exercise','Pridať cvik','dumbbell');
    if(!list.length)return '<div class="empty-state compact"><h2>Žiadny cvik s týmto názvom</h2><p>Skús upraviť vyhľadávanie.</p></div>';
    return `<div class="grid two">${list.map(e=>`<article class="exercise-card"><div class="card-top"><span class="exercise-icon">${icon('dumbbell',30)}</span><button class="icon-btn" data-action="edit-exercise" data-id="${e.id}" aria-label="Upraviť ${esc(e.name)}">${icon('edit')}</button></div><p class="eyebrow">${e.mode==='reps'?'OPAKOVANIA':'SPLNENIE CVIKU'}</p><h2>${esc(e.name)}</h2><p class="exercise-rule">${icon('coin',18)} <strong>${e.reward} ${e.reward===1?'koruna':'korún'}</strong> za ${e.mode==='reps'?`${e.threshold} opakovaní`:'jedno splnenie'}</p>${e.mode==='reps'?`<div class="progress-meta"><span>${e.remainder} / ${e.threshold} do ďalšej odmeny</span><span>Spolu ${e.total}</span></div>${progress(e.remainder,e.threshold)}`:`<p class="muted">Zaznamenané splnenia: <strong>${e.completions}</strong></p>`}<button class="btn primary" data-action="log-exercise" data-id="${e.id}">${icon('plus',18)} ${e.mode==='reps'?'Zapísať opakovania':'Zapísať splnenie'}</button></article>`).join('')}</div>`;
  }
  function gym() { return `<section class="scene gym"><div class="scene-inner">${header('SILA Z MALÝCH KROKOV','Posilňovňa','Každé skutočné opakovanie má svoju hodnotu.',`<button class="btn primary" data-action="add-exercise">${icon('plus')} Pridať cvik</button>`)}<div class="content-panel gym-panel"><div class="library-tools"><div class="search-wrap">${icon('search')}<input class="search-field" id="exercise-search" type="search" placeholder="Nájdi svoj cvik…" aria-label="Hľadať cviky" value="${esc(exerciseSearch)}"></div><span class="muted">Tvoje cviky · tvoje pravidlá</span></div><div id="exercise-results">${exerciseCards()}</div></div><div class="scene-footer">${icon('spark',16)} Zapíš pohyb, ktorý si vykonal v reálnom svete. Nedokončené opakovania sa prenášajú.</div></div></section>`; }
  function village() {
    const points=[['gym','Posilňovňa','dumbbell',24,31],['library','Knižnica','book',45,21],['meditation','Meditácia','tree',59,48],['gallery','Galéria','palette',80,29],['farm','Farma','paw',91,51],['shop','Obchod','shop',14,58],['bank','Banka','bank',77,74],['challenges','Denné výzvy','star',46,48],['calendar','Kalendár','calendar',52,76],['profile','Môj dom','hat',33,84]];
    const today=M.dateKey(); const activities=state.ledger.filter(l=>l.dateKey===today&&['reading','exercise','meditation','project'].includes(l.type)).length;
    return `<section class="scene village village-current"><div class="scene-inner"><div class="village-top"><div><p class="eyebrow">MAGNUM OPUS · TVOJ VLASTNÝ PRÍBEH</p><h1 class="village-title">Vitaj vo svojej dedinke.</h1><p class="village-subtitle">Veľké dielo sa začína malým krokom.</p></div><span class="chapter-mark">Kapitola I<br><strong>Začni pri sebe</strong></span></div><div class="village-map-scroll" tabindex="0" role="region" aria-label="Mapa dedinky. Na menšej obrazovke posuň mapu do strán."><div class="village-map"><img class="village-art" src="assets/village-current.jpg" width="2560" height="1429" alt="Čarodejova dedinka s knižnicou, galériou, domom a nástenkou kalendára" fetchpriority="high" draggable="false"><div class="map-container" aria-label="Klikateľná mapa dedinky">${points.map(([v,label,ic,x,y])=>`<button class="map-point" style="left:${x}%;top:${y}%" data-action="navigate" data-view="${v}" aria-label="Otvoriť ${label}"><span class="point-icon">${icon(ic,21)}</span><span class="point-label">${label}</span></button>`).join('')}</div></div></div><div class="village-bottom">${welcomeDismissed ? `<button type="button" class="welcome-restore" data-action="show-welcome">${icon('spark',14)} Zobraziť úvodnú kartu</button>` : `<div class="today-card"><button type="button" class="welcome-close" data-action="dismiss-welcome" aria-label="Zavrieť úvodnú kartu" title="Zavrieť úvodnú kartu">${icon('close',18)}</button><span class="today-icon">${icon('spark',26)}</span><div><span class="eyebrow">DNES JE DOBRÝ DEŇ ZAČAŤ</span><strong>${activities?`${activities} zaznamenaných krokov. Len tak ďalej.`:'Čo dnes urobíš pre seba?'}</strong><span>Otvor budovu a zapíš svoj prvý pokrok.</span></div><button class="btn primary small" data-action="navigate" data-view="challenges">Denné výzvy ${icon('arrow',16)}</button></div>`}<span class="map-hint">${icon('search',14)} Vyber budovu alebo použi ľavé menu. <span class="map-pan-hint">Mapu môžeš posúvať do strán.</span></span></div></div></section>`;
  }
  function activityList() {
    return state.ledger.slice().reverse().slice(0,25).map(l=>`<div class="activity-row"><span class="activity-icon">${icon({reading:'book',exercise:'dumbbell',meditation:'tree',project:'palette',purchase:'shop',daily:'spark'}[l.type])}</span><div class="activity-info"><strong>${esc(l.label)}</strong><span>${new Date(l.at).toLocaleString('sk-SK',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Bratislava'})}</span></div><span class="activity-amount ${l.coins<0?'negative':'positive'}">${l.coins?`${l.coins>0?'+':''}${l.coins} kor.`:l.powder?`+${l.powder} prášok`:'Zapísané'}</span></div>`).join('') || '<p class="muted">Tvoj príbeh ešte čaká na prvý krok.</p>';
  }
  function settings() {
    return `<section class="page">${header('TVOJE PRAVIDLÁ','Nastavenia','Uloženie, zálohy a odmeny pod tvojou kontrolou.')} ${recovery?`<div class="notice recovery"><h2>Uloženie sa nepodarilo načítať</h2><p>Pôvodné údaje zostali zachované. Obnov platnú zálohu alebo si najprv stiahni pôvodný súbor.</p><div class="card-actions"><button class="btn secondary" data-action="download-raw">Stiahnuť pôvodné údaje</button><button class="btn danger" data-action="reset-recovery">Začať s prázdnym uložením</button></div></div>`:''}<div class="grid two"><section class="card"><p class="eyebrow">TVÔJ PRÍBEH JE U TEBA</p><h2>Záloha a obnova</h2><p class="muted">Herný progres sa automaticky ukladá do lokálneho priečinka tejto hry. Export nižšie obsahuje knihy, obálky, cviky a herné odmeny. Kategórie, fotografie, poznámky a ostatné miestnosti sa ukladajú samostatne do rovnakého priečinka.</p><div class="card-actions"><button class="btn primary" data-action="export">${icon('download')} Exportovať zálohu</button><button class="btn secondary" data-action="import">${icon('upload')} Obnoviť zálohu</button></div><p class="form-hint">Obnova nahradí aktuálny herný progres. Kompletnú zálohu vrátane fotografií a poznámok vytvoríš súborom Zalohovat.cmd v priečinku hry.</p></section><section class="card"><p class="eyebrow">RADOSŤ Z POKROKU</p><h2>Aktivity a odmeny</h2><p>Čítanie: <strong>${state.reading.reward} kor. / ${state.reading.threshold} strán</strong><br>Meditácia: <strong>${state.meditation.reward} kor. / ${state.meditation.threshold} minút</strong></p><p class="muted">Odmeny cvikov upravíš priamo v posilňovni.</p><button class="btn secondary" data-action="edit-rates">${icon('edit')} Upraviť odmeny</button></section></div><section class="card history-card"><div class="card-top"><div><p class="eyebrow">MALÉ KROKY, VEĽKÝ PRÍBEH</p><h2>Posledné aktivity</h2></div><span class="balance-pill">${icon('coin')} ${M.balance(state)} korún</span></div><div class="activity-list">${activityList()}</div></section></section>`;
  }
  function render() {
    if (!window.MOAuth.isAuthenticated()) { window.MOKnowledgeLibrary.deactivate(); return; }
    window.MOKnowledgeLibrary.syncRoute(location.hash);
    $('#main').dataset.room = view;
    window.MOGrimoireWorkbench.beforeRender(view);
    const nav=[['village','Dedinka','home'],['meditation','Meditácia','tree'],['library','Knižnica','book'],['academy','Akadémia','academy','library'],['gym','Posilňovňa','dumbbell'],['gallery','Galéria','palette'],['desk','Alchymistický stôl','flask'],['farm','Farma','paw'],['shop','Obchod','shop'],['challenges','Denné výzvy','star'],['workspace','Pracovňa','book'],['quotes','Citáty','spark'],['bank','Banka','bank'],['calendar','Kalendár','calendar'],['hall','Sieň slávy','star'],['mail','Pošta','mail']];
    const parentView=['study','knowledge'].includes(view)?'profile':view==='academy'?'library':'';
    $('#nav').innerHTML=nav.filter(([id])=>id!=='academy').map(([id,label,ic,parent])=>{
      if(id==='library'){
        const area=window.MOKnowledgeLibrary.mode();
        const children=[['books','Knihy a fotografie','book'],['grimoire','Grimoár','edit'],['tree','Mapa stromu','tree'],['academy','Akadémia','academy']];
        return `<div class="library-nav-group"><div class="library-nav-heading"><button class="nav-item${view==='library'||view==='academy'?' nav-parent-active':''}" ${view==='library'&&area==='room'?'aria-current="page"':''} data-action="navigate" data-view="library"><span class="nav-icon">${icon('book',23)}</span><span class="nav-label">Knižnica</span></button><button type="button" class="library-menu-toggle" data-action="library-menu-toggle" aria-label="Rozbaliť časti Knižnice" aria-expanded="false" aria-controls="library-submenu">⌄</button></div><div id="library-submenu" class="library-submenu" aria-label="Časti Knižnice">${children.map(([child,title,symbol])=>`<a class="nav-item nav-subitem" href="#${child==='academy'?'academy':'library/'+child}" ${view==='academy'&&child==='academy'||view==='library'&&area===child?'aria-current="page"':''}><span class="nav-icon">${icon(symbol,18)}</span><span class="nav-label">${title}</span></a>`).join('')}</div></div>`;
      }
      return `<button class="nav-item${parent?' nav-subitem':''}${parentView===id?' nav-parent-active':''}" ${view===id?'aria-current="page"':parentView===id?'aria-current="location"':''} ${parent?`data-parent="${parent}" aria-label="${parent==='library'?'Knižnica':'Galéria'}: ${label}"`:''} data-action="navigate" data-view="${id}"><span class="nav-icon">${icon(ic,parent?18:23)}</span><span class="nav-label">${label}</span>${id==='challenges'?'<span class="nav-dot" aria-hidden="true"></span>':''}</button>`;
    }).join('');
    $('#profile-name').textContent=state.profile.name; $('#coin-count').textContent=M.balance(state).toLocaleString('sk-SK'); $('#powder-count').textContent=M.powder(state).toLocaleString('sk-SK');
    const outfit=M.CATALOG.find(i=>i.id===state.profile.equipped); document.body.dataset.outfit=state.profile.equipped; if(outfit)document.documentElement.style.setProperty('--outfit-color',outfit.color||'#4058a6');
    const avatar=$('#avatar img'); if(avatar){avatar.src='assets/profile-picture.png';avatar.alt='Tvoja profilová fotografia';avatar.classList.add('personal-profile-picture');}
    if(recovery&&view!=='settings') { view='settings'; history.replaceState(null,'','#settings'); }
    if(view!=='desk'||!$('#desk-root')){const nextPage=view==='village'?village():view==='library'?library():view==='gym'?gym():view==='settings'?settings():view==='desk'?window.MODesk.render():view==='study'?window.MOStudy.render():view==='knowledge'?window.MOKnowledge.render():view==='notes'?window.MODayNotes.render():['hall','mail'].includes(view)?window.MOSocial.render(view):view==='calendar'?window.MOCalendar.render():view==='quotes'?window.MOQuotes.render():['academy','workspace'].includes(view)?window.MOAcademy.render(view):window.MOExtras.render(view);$('#main').innerHTML=nextPage;}
    if(view!=='notes'&&!$('.section-notes-bar'))$('#main').insertAdjacentHTML('afterbegin',`<div class="section-notes-bar"><button type="button" class="btn secondary small" data-action="dn-section" data-section="${view==='knowledge'?'study':view}">${icon('book',15)} Poznámky · ${esc(window.MODayNotes.label(view==='knowledge'?'study':view))}</button></div>`);
    if(parentView&&!$('#room-breadcrumb'))$('#main').insertAdjacentHTML('afterbegin',`<nav id="room-breadcrumb" class="room-breadcrumb" aria-label="Umiestnenie miestnosti"><button type="button" data-action="navigate" data-view="${parentView}">${icon(parentView==='profile'?'hat':parentView==='library'?'book':'palette',16)} ${parentView==='profile'?'Profil':parentView==='library'?'Knižnica':'Galéria'}</button><span aria-hidden="true">›</span>${view==='knowledge'?'<button type="button" data-action="navigate" data-view="study">Osobné štúdium</button><span aria-hidden="true">›</span>':''}<span aria-current="page">${view==='desk'?'Alchymistický stôl':view==='study'?'Osobné štúdium':view==='knowledge'?'Pojmová mapa':'Akadémia'}</span></nav>`);
    if(view==='profile'){
      $('#main .page-header')?.insertAdjacentHTML('afterend',window.MODesktop.controls());
      $('#main .profile-page > .grid.two')?.insertAdjacentHTML('afterend',window.MOShowcase.renderOwn());
      $('#main .page, #main section')?.insertAdjacentHTML('beforeend',window.MOQuotes.controls());
    }
    if(externalChange)$('#main').insertAdjacentHTML('afterbegin','<div class="notice" role="alert"><strong>Hra sa zmenila v inom okne.</strong> Ďalšie úpravy sú pozastavené, aby sa tvoje zmeny neprepísali.<div class="card-actions"><button class="btn secondary small" data-action="export">Exportovať aktuálnu hru</button><button class="btn secondary small" data-action="external-reload">Znova načítať hru</button></div></div>');
    document.title=`${nav.find(n=>n[0]===view)?.[1]||({profile:'Profil',settings:'Nastavenia',study:'Osobné štúdium',knowledge:'Pojmová mapa',notes:'Poznámky'}[view])||'Magnum Opus'} · Magnum Opus`;
    window.MOExtras.afterRender?.(view);
    window.MOAcademy.afterRender?.(view);
    window.MOQuotes.afterRender(view);
    window.MODesk.afterRender(view);
    window.MOGrimoireWorkbench.afterRender(view);
    window.MOCalendar.afterRender(view);
    window.MOStudy.afterRender(view);
    window.MOKnowledge.afterRender(view==='profile'?'':view);
    window.MODayNotes.afterRender(view);
    window.MOSocial.afterRender(view);
    window.MOShowcase.afterRender(view);
    window.MOLibraryCategories.afterRender(view==='library'&&window.MOKnowledgeLibrary.mode()!=='books'?'':view);
    window.MOKnowledgeSourceNavigation?.afterRender(view);
    if(view==='library'&&window.MOKnowledgeLibrary.mode()==='books'&&!window.MOLibraryCategories.isActive())$('.library-panel')?.insertAdjacentHTML('beforebegin',window.MOLibraryCategories.tabs());
    if(view==='village')$('#main').insertAdjacentHTML('afterbegin',`<div class="village-social-links"><button class="btn secondary small" type="button" data-action="navigate" data-view="hall">${icon('star',17)} Sieň slávy</button><button class="btn secondary small" type="button" data-action="navigate" data-view="mail">${icon('mail',17)} Pošta</button></div>`);
    if(view==='library'&&window.MOKnowledgeLibrary.mode()==='books'&&!window.MOLibraryCategories.isActive()&&!$('[data-action="goodreads-open"]')){
      const historical=M.previewHistoricalReading(state);if(historical.pages>0)$('.page-header .toolbar')?.insertAdjacentHTML('beforeend',`<button type="button" class="btn secondary" data-action="claim-book-history">${icon('coin',17)} Doplniť koruny za dočítané knihy</button>`);
      $('.page-header .toolbar')?.insertAdjacentHTML('afterbegin','<button class="btn secondary" data-action="goodreads-open">Goodreads · import</button>'+(state.settings.goodreadsUrl?`<a class="btn ghost small" href="${esc(state.settings.goodreadsUrl)}" target="_blank" rel="noopener noreferrer">Môj Goodreads ↗</a>`:''));
      document.querySelectorAll('.book-card').forEach(card=>{const b=state.books.find(b=>b.id===card.querySelector('[data-id]')?.dataset.id);if(b?.goodreads){const g=b.goodreads;card.querySelector('.book-author')?.insertAdjacentHTML('afterend',`<p class="form-hint">Goodreads${g.rating?' · '+g.rating+' / 5 ★':''}${g.isbn?' · ISBN '+esc(g.isbn):''}${g.id?` · <a href="https://www.goodreads.com/book/show/${g.id}" target="_blank" rel="noopener noreferrer">Detail ↗</a>`:''}</p>`);}});
    }
    if(view==='study'&&!$('.knowledge-entry'))$('.page-header')?.insertAdjacentHTML('afterend','<div class="content-panel knowledge-entry"><div><p class="eyebrow">PREPOJENÉ ZDROJE</p><h2>Pojmová mapa</h2><p>Dokumenty, fotky a poznámky nájdeš podľa pojmov a tém.</p></div><button class="btn primary" data-action="knowledge-study-open">Otvoriť pojmy vybraného predmetu →</button></div>');
    if(view==='library'&&window.MOKnowledgeLibrary.mode()==='books'&&!$('.building-rooms'))$('.page-header')?.insertAdjacentHTML('afterend',`<div class="building-rooms"><button type="button" class="building-room" data-action="navigate" data-view="academy"><span class="building-room-icon">${icon('academy',28)}</span><span><small>MIESTNOSŤ KNIŽNICE</small><strong>Akadémia</strong><span>Spoločné projekty a chat</span></span>${icon('arrow',22)}</button></div>`);
    if(view==='settings')$('#main .grid.two')?.insertAdjacentHTML('afterend',window.MOHydration.controls());
    window.MOHydration.afterRender(view);
    if(view==='settings')$('#main .grid.two')?.insertAdjacentHTML('afterend',window.MODesktop.controls());
    window.MODesktop.afterRender();
    window.MOAuth.renderControls?.();
    window.MOKnowledgeLibrary.afterRender(view);
    window.MOProfileWindows?.afterRender(view);
    window.MOLearning?.afterRender();
  }
  function bookForm(id) {
    const b=id?state.books.find(b=>b.id===id):null; if(id&&!b)return;
    openModal(b?'Upraviť knihu':'Pridať novú knihu',`<div class="form-grid">${field('Názov knihy','title',b?.title||'','text','required maxlength="160"')}${field('Autor','author',b?.author||'','text','maxlength="160"')}${field('Celkový počet strán','total',b?.total||'','number',`required min="${b?Math.max(1,b.current):1}" max="100000" step="1"`)}${!b?field('Už prečítané strany','current',0,'number','required min="0" max="100000" step="1"'):`<div class="field"><label>Aktuálny progres</label><p>${b.current} / ${b.total} strán</p></div>`}<div class="field full"><label for="f-tags">Vlastné tagy</label><input id="f-tags" name="tags" value="${esc(b?.tags.join(', ')||'')}" maxlength="800" placeholder="napr. osobný rozvoj, filozofia"><span class="form-hint">Oddeľ tagy čiarkou.</span></div><div class="field full"><label for="f-cover">Obálka knihy</label><input id="f-cover" name="cover" type="file" accept="image/png,image/jpeg,image/webp"><span class="form-hint">Fotografia alebo screenshot. Bez obrázka vytvoríme vlastnú knižnú obálku.</span>${b?.cover?'<label class="checkbox-label"><input type="checkbox" name="removeCover"> Odstrániť súčasnú obálku</label>':''}</div></div>${!b?'<p class="form-hint">Už prečítané strany nastavujú východiskový stav. Koruny získaš za nové čítanie.</p>':''}`,async fd=>{
      const payload={title:String(fd.get('title')).trim(),author:String(fd.get('author')).trim(),total:Number(fd.get('total')),tags:[...new Set(String(fd.get('tags')).split(',').map(t=>t.trim()).filter(Boolean))],cover:b?.cover||''};
      if(!b)payload.current=Number(fd.get('current')); if(fd.get('removeCover'))payload.cover='';
      const file=fd.get('cover'); if(file?.size)payload.cover=await coverData(file);
      commit(s=>b?M.updateBook(s,b.id,payload):M.addBook(s,payload),b?'Kniha je upravená.':'Nový svet pribudol do tvojej knižnice.');
    });
  }
  async function coverData(file) {
    if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Vyber obrázok vo formáte PNG, JPG alebo WebP.');
    if(file.size>12*1024*1024)throw new Error('Obrázok je príliš veľký. Vyber súbor do 12 MB.');
    const raw=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('Obrázok sa nepodarilo načítať.'));r.readAsDataURL(file);});
    const img=await new Promise((resolve,reject)=>{const el=new Image();el.onload=()=>resolve(el);el.onerror=()=>reject(new Error('Obrázok sa nepodarilo otvoriť.'));el.src=raw;});
    const scale=Math.min(1,600/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.width*scale));c.height=Math.max(1,Math.round(img.height*scale));c.getContext('2d').drawImage(img,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.85);
  }
  function exerciseForm(id) {
    const e=id?state.exercises.find(e=>e.id===id):null;
    openModal(e?'Upraviť cvik':'Pridať vlastný cvik',`<div class="form-grid">${field('Názov cviku','name',e?.name||'','text','required maxlength="120"')}<div class="field"><label for="f-mode">Odmenu získam</label><select id="f-mode" name="mode"><option value="reps" ${e?.mode!=='completion'?'selected':''}>Za počet opakovaní</option><option value="completion" ${e?.mode==='completion'?'selected':''}>Za splnenie cviku</option></select></div>${field('Opakovaní za jednu odmenu','threshold',e?.threshold||10,'number','required min="1" max="100000" step="1"')}${field('Odmena v korunách','reward',e?.reward||1,'number','required min="1" max="10000" step="1"')}</div><p class="form-hint">Pri odmene za splnenie sa počet opakovaní nepoužíva. Zmena pravidla začne nový cyklus opakovaní; získané koruny a celkový progres zostávajú.</p>`,fd=>{const mode=String(fd.get('mode'));const p={name:String(fd.get('name')).trim(),mode,threshold:mode==='completion'?1:Number(fd.get('threshold')),reward:Number(fd.get('reward'))};commit(s=>e?M.updateExercise(s,e.id,p):M.addExercise(s,p),e?'Cvik je upravený.':'Tvoj nový cvik je pripravený.');});
    const sync=()=>{const input=$('#f-threshold');input.disabled=$('#f-mode').value==='completion';input.closest('.field').classList.toggle('field-disabled',input.disabled);};$('#f-mode').addEventListener('change',sync);sync();
  }
  function download(data,name) { const url=URL.createObjectURL(new Blob([data],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000); }
  function exportBackup(){download(JSON.stringify({app:'magnum-opus',exportedAt:new Date().toISOString(),state},null,2),`magnum-opus-zaloha-${M.dateKey()}.json`);toast('Záloha je pripravená na stiahnutie.');}
  function importBackup() {
    assertWritable();
    openModal('Obnoviť zo zálohy','<div class="field full"><label for="backup-file">Vyber zálohu Magnum Opus</label><input id="backup-file" name="backup" type="file" accept=".json,application/json" required></div><p class="notice">Obnova nahradí herný progres prihláseného čarodeja a uloží ho do účtu. Pred pokračovaním si môžeš exportovať svoju súčasnú zálohu.</p>',async fd=>{
      const f=fd.get('backup');if(!f?.size)throw new Error('Vyber súbor so zálohou.');if(f.size>15*1024*1024)throw new Error('Záloha je príliš veľká.');
      let data;try{data=JSON.parse(await f.text());}catch{throw new Error('Súbor nie je platná JSON záloha.');}
      const clean=M.validateState(data.app==='magnum-opus'?data.state:data);
      assertWritable();
      try{localStorage.setItem(KEY,JSON.stringify(clean));}catch{throw new Error('Záloha sa nezmestila do úložiska prehliadača. Súčasné údaje zostali zachované.');}
      state=clean;recovery='';window.MOAuth.queueSave(clean);render();toast('Tvoj príbeh bol obnovený.');
    },{submitLabel:'Obnoviť progres'});
  }
  async function handleAction(action,el) {
    if(window.MODesktop.handleAction(action))return;
    if (!window.MOAuth.isAuthenticated()) return;
    if(action==='library-menu-toggle'){
      const group=el.closest('.library-nav-group'), expanded=!group.classList.contains('is-expanded');
      group.classList.toggle('is-expanded',expanded); group.classList.toggle('is-collapsed',!expanded);
      el.setAttribute('aria-expanded',String(expanded)); return;
    }
    if(window.MOKnowledgeLibrary.handleAction(action,el))return;
    if(await window.MOLibraryCategories.handleAction(action,el))return;
    if(await window.MOKnowledge.handleAction(action,el))return;
    const id=el.dataset.id;
    if(action==='dismiss-welcome'||action==='show-welcome'){
      welcomeDismissed=action==='dismiss-welcome';
      try{if(welcomeDismissed)localStorage.setItem(KEY+':welcome-dismissed','1');else localStorage.removeItem(KEY+':welcome-dismissed');}catch(_){}
      render();requestAnimationFrame(()=>$(welcomeDismissed?'.welcome-restore':'.welcome-close')?.focus());return;
    }
    if(action==='navigate'){navigate(el.dataset.view);return;}
    if(action==='external-reload'){openModal('Znova načítať hru?', '<p>Toto okno sa znova načíta a použije aktuálne uložené údaje. Ak si chceš uchovať jeho súčasný stav, najprv ho exportuj.</p>',()=>window.location.reload(),{submitLabel:'Znova načítať'});return;}
    if(action==='add-book'||action==='edit-book'){bookForm(id);return;}
    if(action==='book-notes'){
      const b=state.books.find(b=>b.id===id);if(!b)return;
      openModal('Poznámky ku knihe',`<p class="modal-lead">${esc(b.title)}</p><div class="field"><label for="book-notes-text">Tvoje myšlienky a poznámky</label><textarea id="book-notes-text" name="notes" rows="12" maxlength="20000">${esc(b.notes||'')}</textarea><span class="form-hint">Poznámky sú súkromné a zobrazujú sa po otvorení knihy.</span></div>`,fd=>commit(s=>M.updateBook(s,b.id,{notes:String(fd.get('notes'))}),'Poznámky ku knihe sú uložené.'));return;
    }
    if(action==='claim-book-history'){
      const h=M.previewHistoricalReading(state);if(!h.pages){toast('Všetky dočítané knihy už majú odmenu započítanú.');return;}
      openModal('Doplniť koruny za dočítané knihy',`<p><strong>${h.books}</strong> kníh · <strong>${h.pages}</strong> doteraz neodmenených strán</p><div class="reward-preview"><strong>+${h.earned} korún</strong></div><p class="form-hint">Použije sa tvoje súčasné pravidlo: ${state.reading.reward} kor. za ${state.reading.threshold} strán. Už odmenené strany sa nezapočítajú znova. Historické čítanie nesplní dnešné výzvy.</p>`,()=>{const {result}=commit(s=>M.claimHistoricalReading(s));toast(`Doplnených ${result.earned} korún za ${result.books} dočítaných kníh.`);},{submitLabel:'Pripísať koruny'});return;
    }
    if(action==='book-detail'){
      const b=state.books.find(b=>b.id===id);if(!b)return;openModal(b.title,`<div class="detail-layout">${bookCover(b,'detail-cover')}<div><p class="eyebrow">TVOJA KNIHA</p><h3>${esc(b.author||'Autor neuvedený')}</h3><div class="tag-list">${b.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div><div class="progress-meta"><span>${b.current} / ${b.total} strán</span><span>${Math.round(b.current/b.total*100)} %</span></div>${progress(b.current,b.total)}<div class="card-actions"><button class="btn primary small" type="button" data-action="read-book" data-id="${b.id}" ${b.current===b.total?'disabled':''}>Zapísať čítanie</button><button class="btn secondary small" type="button" data-action="edit-book" data-id="${b.id}">Upraviť knihu</button><button class="btn secondary small" type="button" data-action="book-notes" data-id="${b.id}">${b.notes?'Upraviť poznámky':'Pridať poznámky'}</button></div></div></div><section class="book-private-notes"><h3>Moje poznámky</h3><p class="daynote-full">${esc(b.notes||'Ku knihe ešte nemáš poznámky.')}</p></section>`,null,{readOnly:true});return;
    }
    if(action==='read-book'){
      const b=state.books.find(b=>b.id===id);if(!b)return;
      openModal('Zapísať čítanie',`<p class="modal-lead">${esc(b.title)}</p>${field('Na ktorú stranu si sa dostal?','page',Math.min(b.total,b.current+1),'number',`required min="${b.current+1}" max="${b.total}" step="1"`)}<p class="form-hint">Teraz máš prečítaných ${b.current} strán. Započíta sa iba nový progres.</p><div class="reward-preview" id="read-preview"></div>`,fd=>{const {result}=commit(s=>M.readBook(s,b.id,Number(fd.get('page'))));toast(result.earned?`Nové strany, nové možnosti. +${result.earned} korún.`:'Čítanie je uložené. Každá strana sa počíta.');},{submitLabel:'Uložiť čítanie'});
      const update=()=>{const amount=Math.max(0,Number($('#f-page').value)-b.current);$('#read-preview').textContent=`${amount} nových strán · +${Math.floor((state.reading.remainder+amount)/state.reading.threshold)*state.reading.reward} korún`;};$('#f-page').addEventListener('input',update);update();return;
    }
    if(action==='filter-tag'){bookTag=el.dataset.tag||'';if($('#modal').open)$('#modal').close();navigate('library');return;}
    if(action==='clear-book-search'){bookSearch='';bookTag='';render();$('#book-search')?.focus();return;}
    if(action==='add-exercise'||action==='edit-exercise'){exerciseForm(id);return;}
    if(action==='log-exercise'){
      const e=state.exercises.find(e=>e.id===id);if(!e)return;const reps=e.mode==='reps';
      openModal(e.name,reps?`${field('Koľko opakovaní si vykonal?','count',e.threshold,'number','required min="1" max="100000" step="1"')}<div class="reward-preview" id="exercise-preview"></div>`:`<div class="reward-preview">${icon('check',30)}<p>Potvrdzujem, že som cvik vykonal v reálnom svete.</p><strong>+${e.reward} korún</strong></div>`,fd=>{const {result}=commit(s=>M.logExercise(s,e.id,reps?Number(fd.get('count')):1));toast(result.earned?`Pohyb sa počíta. +${result.earned} korún.`:'Opakovania sú uložené do ďalšej odmeny.');},{submitLabel:reps?'Zapísať opakovania':'Potvrdiť splnenie'});
      if(reps){const update=()=>{const n=Math.max(0,Number($('#f-count').value));$('#exercise-preview').textContent=`${n} opakovaní · +${Math.floor((e.remainder+n)/e.threshold)*e.reward} korún`;};$('#f-count').addEventListener('input',update);update();}return;
    }
    if(action==='export'){exportBackup();return;}if(action==='import'){importBackup();return;}
    if(action==='download-raw'){download(localStorage.getItem(KEY)||'{}','magnum-opus-povodne-udaje.json');return;}
    if(action==='reset-recovery'){openModal('Nový začiatok','<p>Pôvodné nečitateľné uloženie bude nahradené prázdnym progresom. Ak ho chceš uchovať, najprv ho stiahni v Nastaveniach.</p>',()=>{assertWritable();const clean=M.createState();localStorage.setItem(KEY,JSON.stringify(clean));state=clean;recovery='';window.MOAuth.queueSave(clean);render();toast('Nový príbeh je pripravený.');},{submitLabel:'Začať nový príbeh'});return;}
    if(action==='edit-rates'){
      openModal('Aktivity a odmeny',`<h3>Čítanie</h3><div class="form-grid">${field('Počet strán za odmenu','rt',state.reading.threshold,'number','required min="1" max="100000" step="1"')}${field('Odmena v korunách','rr',state.reading.reward,'number','required min="1" max="10000" step="1"')}</div><h3>Meditácia</h3><div class="form-grid">${field('Počet minút za odmenu','mt',state.meditation.threshold,'number','required min="1" max="100000" step="1"')}${field('Odmena v korunách','mr',state.meditation.reward,'number','required min="1" max="10000" step="1"')}</div><p class="notice">Zmena pravidla začne nový cyklus danej aktivity. Zvyšok rozpracovanej odmeny sa vynuluje; už získané koruny a história zostávajú.</p>`,fd=>commit(s=>{for(const [key,t,r]of[['reading','rt','rr'],['meditation','mt','mr']]){const threshold=Number(fd.get(t)),reward=Number(fd.get(r));if(!Number.isInteger(threshold)||threshold<1||threshold>100000||!Number.isInteger(reward)||reward<1||reward>10000)throw new Error('Zadaj platné celé kladné hodnoty.');if(s[key].threshold!==threshold||s[key].reward!==reward)s[key].remainder=0;s[key].threshold=threshold;s[key].reward=reward;}},'Tvoje pravidlá sú uložené.'));return;
    }
    if(window.MOHydration.handleAction(action,el))return;
    if(await window.MODesk.handleAction(action,el))return;
    if(await window.MODayNotes.handleAction(action,el))return;
    if(await window.MOShowcase.handleAction(action,el))return;
    if(await window.MOSocial.handleAction(action,el))return;
    if(await window.MOCalendar.handleAction(action,el))return;
    if(await window.MOStudy.handleAction(action,el))return;
    if(window.MOGoodreads.handleAction(action,el))return;
    if(await window.MOQuotes.handleAction(action,el))return;
    if(await window.MOAcademy.handleAction(action,el))return;
    if(window.MOExtras.handleAction(action,el))return;
  }
  window.MOApp={get state(){return state;},model:M,esc,icon,toast,commit,openModal,navigate,render,uid:()=>crypto.randomUUID()};
  document.addEventListener('click',async event=>{
    const close=event.target.closest('[data-close-modal]');if(close){event.preventDefault();$('#modal').close();return;}
    const el=event.target.closest('[data-action]');if(!el||el.disabled)return;event.preventDefault();try{await handleAction(el.dataset.action,el);}catch(error){toast(error.message||'Akciu sa nepodarilo dokončiť.');}
  });
  $('#modal-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!modalCallback||$('#modal-save').disabled)return;
    const cb=modalCallback,form=event.currentTarget,dialog=$('#modal'),body=$('#modal-body'),marker=body.firstElementChild;
    if(!form.reportValidity())return;
    const save=$('#modal-save'),current=()=>dialog.open&&modalCallback===cb&&body.firstElementChild===marker;
    save.disabled=true;
    try{await cb(new FormData(form),form);if(current())dialog.close();}
    catch(error){if(current())$('#modal-error').textContent=error.message||'Skontroluj zadané údaje.';}
    finally{if(current())save.disabled=false;}
  });
  $('#modal').addEventListener('click',event=>{if(event.target===$('#modal')){const r=$('#modal').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('#modal').close();}});
  document.addEventListener('input',event=>{if(event.target.id==='book-search'){bookSearch=event.target.value;$('#book-results').innerHTML=bookCards();}if(event.target.id==='exercise-search'){exerciseSearch=event.target.value;$('#exercise-results').innerHTML=exerciseCards();}});
  $('#mobile-toggle')?.addEventListener('click',()=>{document.body.classList.toggle('menu-open');$('#mobile-toggle').setAttribute('aria-expanded',document.body.classList.contains('menu-open'));});
  $('.sidebar-overlay')?.addEventListener('click',closeMenu);
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenu();});
  window.addEventListener('hashchange',()=>{const target=routeView(location.hash.slice(1));if(target){view=target;closeMenu();render();}});
  const libraryMenuState=event=>{
    const group=event.target.closest?.('.library-nav-group');
    if(!group)return;
    if((event.type==='pointerover'||event.type==='focusin')&&!group.contains(event.relatedTarget))group.classList.remove('is-collapsed');
    requestAnimationFrame(()=>{
      const open=!group.classList.contains('is-collapsed')&&(group.classList.contains('is-expanded')||group.matches(':focus-within')||matchMedia('(hover: hover)').matches&&group.matches(':hover'));
      group.querySelector('.library-menu-toggle')?.setAttribute('aria-expanded',String(open));
    });
  };
  for(const event of ['pointerover','pointerout','focusin','focusout'])$('#nav').addEventListener(event,libraryMenuState);
  $('#nav').addEventListener('click',event=>{
    const link=event.target.closest('.library-submenu a');
    if(!link||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
    event.preventDefault();navigate(link.getAttribute('href').slice(1));
  });
  $('#nav').addEventListener('keydown',event=>{
    const group=event.target.closest('.library-nav-group');
    if(event.key!=='Escape'||!group)return;
    group.classList.remove('is-expanded');group.classList.add('is-collapsed');
    const toggle=group.querySelector('.library-menu-toggle');toggle.focus();toggle.setAttribute('aria-expanded','false');
  });
  window.addEventListener('storage',event=>{
    if(!KEY||event.key!==KEY||!window.MOAuth.isAuthenticated())return;
    try{if(event.newValue&&JSON.stringify(M.validateState(JSON.parse(event.newValue)))===JSON.stringify(state))return;}catch(_){}
    externalChange=true;
    window.MOAuth.pauseForExternalChange?.();
    render();
    toast('Hra sa zmenila v inom okne. Ďalšie úpravy sú pozastavené.');
  });
  let displayedDay=M.dateKey();setInterval(()=>{const day=M.dateKey();if(day!==displayedDay){displayedDay=day;render();}},30000);
  window.MOAuth.init({
    getLegacyState:()=>legacyState ? JSON.parse(JSON.stringify(legacyState)) : null,
    getState:()=>state,
    applyServerState(loaded) {
      state=M.validateState(loaded);
      try { localStorage.setItem(KEY,JSON.stringify(state)); }
      catch (_) { toast('Pomocnú kópiu sa nepodarilo uložiť. Serverová odmena zostáva zachovaná.'); }
      $('#coin-count').textContent=M.balance(state);
      window.MOLearning?.afterRender();
    },
    exportBackup,
    activate({account,state:loaded}) {
      const clean=M.validateState(loaded);
      KEY=`magnum-opus:account:${account.id}`;
      state=clean; recovery='';externalChange=false;
      try{welcomeDismissed=localStorage.getItem(KEY+':welcome-dismissed')==='1';}catch(_){welcomeDismissed=false;}
      try { localStorage.setItem(KEY,JSON.stringify(clean)); } catch (_) { toast('Prehliadač nemá miesto na pomocnú kópiu. Ukladanie do priečinka hry zostáva dostupné.'); }
      render();
    },
    deactivate({preserveDraft}={}) {
      window.MOKnowledgeLibrary.deactivate();
      window.MOGrimoireWorkbench.destroy();
      window.MOAcademy.destroy?.({preserveDraft:!!preserveDraft});
      window.MOQuotes.destroy();
      window.MODesk.destroy({preserveDraft:!!preserveDraft});
      window.MOCalendar.destroy();
      window.MOStudy.destroy({preserveDraft:!!preserveDraft});
      window.MOKnowledge.destroy({preserveDraft:!!preserveDraft});
      window.MOKnowledgeReader?.destroy();
      window.MODayNotes.destroy({preserveDraft:!!preserveDraft});
      window.MOSocial.destroy({preserveDraft:!!preserveDraft});
      window.MOShowcase.destroy();
      window.MOHydration.destroy();
      window.MODesktop.destroy();
      window.MOLibraryCategories.destroy();
      if(KEY&&!preserveDraft) { try {
        const raw=localStorage.getItem(KEY),sync=JSON.parse(localStorage.getItem(KEY+':sync')||'null');
        if(raw===JSON.stringify(state)&&!(sync&&sync.pending)){localStorage.removeItem(KEY);localStorage.removeItem(KEY+':sync');}
      } catch (_) { /* Preserve a possible draft from another window. */ } }
      KEY=null;state=M.createState();recovery='';bookSearch='';bookTag='';exerciseSearch='';externalChange=false;welcomeDismissed=false;
      if($('#modal').open)$('#modal').close();
      $('#main').innerHTML='';$('#nav').innerHTML='';$('#profile-name').textContent='Čarodej';$('#coin-count').textContent='0';$('#powder-count').textContent='0';
      closeMenu();
    }
  });
})();
