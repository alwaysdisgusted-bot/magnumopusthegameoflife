(function () {
  'use strict';
  var state = null, accountId = '', revision = 0, updatedAt = null, generation = 0;
  var loading = false, loaded = false, loadError = '', active = false, dirty = false, conflict = false, lastError = '';
  var saveTimer = null, saving = null, sequence = 0, savedSequence = 0, cacheFailed = false, cacheChain = Promise.resolve();
  var selected = '', tool = 'pen', color = '#ffffff', brushSize = 2, scale = 1, zoom = '1', embedded = null, externalControls = null;
  var controlGroup = 'drawing';
  var canvases = [], primary = null, canvasId = 'main', switchingCanvas = false;
  var canvasEpoch = 0;
  var usageCache = null;
  var canvasHistory = new Map();
  var undo = [], redo = [], gesture = null, textEdit = null, mounted = null, resizeObserver = null;
  var held = new Map(), images = new Map(), database = null, damagedDraft = null, cacheStamp = 0, includeGridPNG = false;
  var COLORS = ['#fff2a8','#f4c7d9','#cbe5b0','#c1e4ed','#dbcdf0','#f8d2a9'];
  var TOOLS = [['select','↖','Vybrať'],['pen','✎','Pero'],['eraser','▱','Guma'],['line','╱','Čiara'],['rect','□','Obdĺžnik'],['ellipse','○','Elipsa']];
  var app = function () { return window.MOApp; }, auth = function () { return window.MOAuth; }, model = function () { return window.MODeskModel; };
  var esc = function (v) { return app().esc(v); }, uid = function () { return crypto.randomUUID(); };
  function user() { return auth() && auth().getAccount ? auth().getAccount() : null; }
  function gridOf(value) { return Object.assign({enabled:false,spacing:24,style:'dots',color:'#85744d',opacity:.15},value.grid||{}); }
  function copy(value) { return { version: value.version, width: value.width, height: value.height, background: value.background, grid: gridOf(value), strokes: value.strokes.map(function (s) { return Object.assign({},s,{points:s.points.map(function(p){return {x:p.x,y:p.y};})}); }), items: value.items.map(function(i){return Object.assign({},i);}) }; }
  function writable() { if (!user() || user().id !== accountId || !auth().isAuthenticated()) throw new Error('Najprv sa prihlás do svojho účtu.'); if (!loaded) throw new Error('Stôl sa ešte načítava.'); if(switchingCanvas)throw new Error('Počkaj na uloženie a prepnutie kanvasu.'); }
  function root() { return embedded || document.getElementById('desk-root'); }
  function control(selector) { return externalControls?.querySelector(selector) || root()?.querySelector(selector); }
  function toolButtons() { return externalControls ? externalControls.querySelectorAll('[data-tool]') : root().querySelectorAll('[data-tool]'); }
  function prepareEmbedded(value) { if(embedded){value.width=10000;value.height=10000;value.background='#000000';}return value; }
  function displayed() { return embedded ? prepareEmbedded(copy(state)) : state; }
  function rememberCanvas() {
    if (!state) return;
    if (canvasId === 'main') primary = copy(state);
    else canvases.find(function(c){return c.id===canvasId;}).state = copy(state);
  }
  function snapshot() {
    rememberCanvas();
    var value=copy(primary);
    if(canvases.length)value.canvases=canvases.map(function(c){return {id:c.id,name:c.name,state:copy(c.state)};});
    return value;
  }
  function restoreLibrary(value) {
    var clean=model().validateState(value);
    canvases=clean.canvases||[];primary=copy(clean);canvasId='main';state=copy(primary);canvasHistory.clear();canvasEpoch++;
  }
  function canvasContext() { writable();return {generation:generation,account:accountId,epoch:canvasEpoch,sequence:sequence}; }
  function checkCanvas(context, unchanged) {
    if(context.generation!==generation||context.account!==accountId||user()?.id!==context.account)throw stale();
    if(context.epoch!==canvasEpoch)throw new Error('Kanvas sa počas prípravy zmenil. Operácia sa zrušila bez nahradenia obsahu; zopakuj ju na správnej ploche.');
    if(unchanged&&(context.sequence!==sequence||gesture||textEdit))throw new Error('Počas načítania pribudli úpravy. Zostali zachované; zopakuj načítanie, až keď budeš pripravený.');
    writable();
  }
  function validateCanvas(value) {
    var candidate=copy(canvasId==='main'?value:primary);
    if(canvases.length)candidate.canvases=canvases.map(function(c){return {id:c.id,name:c.name,state:copy(c.id===canvasId?value:c.state)};});
    var clean=model().validateState(candidate);
    return canvasId==='main'?copy(clean):copy(clean.canvases.find(function(c){return c.id===canvasId;}).state);
  }
  function nextCanvasName(base) {
    var names=new Set(canvases.map(function(c){return c.name.toLocaleLowerCase('sk');})),name=base.slice(0,80),index=2;
    while(names.has(name.toLocaleLowerCase('sk'))){var suffix=' ('+index+')';index++;name=base.slice(0,80-suffix.length)+suffix;}
    return name;
  }
  function notify(message) { app().toast(message); }
  function run(promise) { Promise.resolve(promise).catch(function(e){ if(e.code!=='STALE_DESK') notify(e.message || 'Zmenu sa nepodarilo dokončiť.'); }); }
  function stale() { var e = new Error('Prihlásenie sa zmenilo.'); e.code = 'STALE_DESK'; return e; }
  async function api(options) { var id = accountId, gen = generation; var data = await auth().api('/api/desk',options); if(gen!==generation || !user() || user().id!==id) throw stale(); return data; }
  function databaseOpen() {
    if (!database) database = new Promise(function(resolve,reject){
      if (!window.indexedDB) return reject(new Error('Úložisko nie je dostupné.'));
      var request = indexedDB.open('magnum-opus-desks',1);
      request.onupgradeneeded = function(){ request.result.createObjectStore('drafts'); };
      request.onsuccess = function(){ resolve(request.result); }; request.onerror = function(){ reject(request.error); };
    });
    return database;
  }
  async function cacheRead(id) {
    var record=null,fallback=null;
    try { var db=await databaseOpen(); record=await new Promise(function(resolve,reject){var r=db.transaction('drafts').objectStore('drafts').get(id);r.onsuccess=function(){resolve(r.result);};r.onerror=function(){reject(r.error);};}); } catch(_){}
    try { fallback=JSON.parse(localStorage.getItem('magnum-opus:desk:'+id)||'null'); } catch(_){}
    if(!record)return fallback;if(!fallback)return record;
    return (Number(fallback.cachedAt)||0)>(Number(record.cachedAt)||0)||((Number(fallback.cachedAt)||0)===(Number(record.cachedAt)||0)&&fallback.pending)?fallback:record;
  }
  function cacheWrite(record,id) {
    record.cachedAt=cacheStamp=Math.max(Date.now(),cacheStamp+1);
    cacheChain = cacheChain.catch(function(){}).then(async function(){
      try { var db=await databaseOpen(); await new Promise(function(resolve,reject){var tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put(record,id);tx.oncomplete=resolve;tx.onerror=function(){reject(tx.error);};tx.onabort=function(){reject(tx.error);};}); cacheFailed=false; }
      catch(_) { try { localStorage.setItem('magnum-opus:desk:'+id,JSON.stringify(record)); cacheFailed=false; } catch(e) { cacheFailed=true; } }
      updateStatus();
    });
    return cacheChain;
  }
  function cacheCurrent() { if(state && accountId) return cacheWrite({state:snapshot(),revision:revision,updatedAt:updatedAt,pending:dirty},accountId); return Promise.resolve(); }
  async function cacheRemove(id) { await cacheChain.catch(function(){}); try{var db=await databaseOpen();await new Promise(function(resolve){var tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').delete(id);tx.oncomplete=resolve;tx.onerror=resolve;});}catch(_){} try{localStorage.removeItem('magnum-opus:desk:'+id);}catch(_){} }
  function reset() { clearTimeout(saveTimer); saveTimer=null; finishGesture(); finishText(); generation++; loaded=false; loading=false; state=null; revision=0; updatedAt=null; dirty=false; conflict=false; lastError='';loadError='';saving=null;selected='';undo=[];redo=[];mounted=null;sequence=0;savedSequence=0;images.clear();damagedDraft=null;includeGridPNG=false;canvases=[];primary=null;canvasId='main';canvasHistory.clear();switchingCanvas=false; }
  function syncAccount() {
    var current=user(), id=current?current.id:'';
    if(id!==accountId) { if(accountId && state && dirty) held.set(accountId,{state:snapshot(),revision:revision,updatedAt:updatedAt,pending:true}); reset();accountId=id; }
    return !!id;
  }
  async function load() {
    if(loading || loaded || !accountId)return; loading=true;loadError='';var gen=generation,id=accountId;paintLoading();
    try {
      var results=await Promise.all([api(),cacheRead(id)]),cloud=results[0],cached=held.get(id)||results[1];
      if(gen!==generation || id!==accountId)return;
      restoreLibrary(cloud.state);revision=cloud.revision;updatedAt=cloud.updatedAt;
      if(cached && cached.pending) {
        try { if(!Number.isSafeInteger(cached.revision)||cached.revision<0)throw new Error('Neplatná revízia.');var cloudRevision=revision;restoreLibrary(cached.state);dirty=true;revision=cached.revision;sequence++;if(revision!==cloudRevision) {conflict=true;lastError='Stôl na serveri sa zmenil v inom okne. Tvoj rozpracovaný stôl zostal zachovaný.';} }
        catch(_) { damagedDraft={record:cached,accountId:id};throw new Error('Lokálny rozpracovaný stôl sa nepodarilo načítať. Pôvodnú kópiu si môžeš stiahnuť a potom načítať stôl zo servera.'); }
      }
      loaded=true;loading=false;held.delete(id);damagedDraft=null;mount();if(dirty&&!conflict)scheduleSave();
    } catch(e) { if(gen!==generation || e.code==='STALE_DESK')return;loading=false;loadError=e.message;paintLoading(); }
  }
  function render() { return '<section id="desk-root" class="desk-page"><div class="desk-loading" role="status">Otvárame alchymistický stôl…</div></section>'; }
  function paintLoading() { var el=root(); if(!el)return;el.innerHTML='<div class="desk-loading"><span class="desk-sigil" aria-hidden="true">⚗</span><h1>Alchymistický stôl</h1><p'+(loadError?' role="alert"':' role="status"')+'>'+esc(loadError||'Pripravujeme tvoje nápady…')+'</p>'+(damagedDraft&&damagedDraft.accountId===accountId?'<div class="card-actions">'+button('export-damaged','Stiahnuť pôvodné údaje')+button('discard-damaged','Použiť stôl zo servera')+'</div>':loadError?'<button class="btn primary" data-action="desk-retry">Skúsiť znova</button>':'')+'</div>'; }
  function button(action,label,extra) { return '<button type="button" class="desk-button" data-action="desk-'+action+'" '+(extra||'')+'>'+label+'</button>'; }
  function gridControls() {
    var grid=gridOf(state);
    return '<details class="desk-grid-menu"><summary>▦ Mriežka <span aria-hidden="true">⌄</span></summary><div class="desk-grid-popover"><label class="desk-grid-toggle"><input type="checkbox" data-desk-grid="enabled" '+(grid.enabled?'checked':'')+'> Zobraziť mriežku</label><label class="desk-grid-field"><span>Rozostup</span><span><input type="number" min="10" max="100" step="1" data-desk-grid="spacing" value="'+grid.spacing+'" aria-label="Rozostup mriežky v pixeloch"> px</span></label><label class="desk-grid-field"><span>Vzor</span><select data-desk-grid="style" aria-label="Vzor mriežky"><option value="dots">Bodky</option><option value="lines">Čiary</option></select></label><label class="desk-grid-field"><span>Farba</span><input type="color" data-desk-grid="color" value="'+grid.color+'" aria-label="Farba mriežky"></label><label class="desk-grid-opacity"><span>Viditeľnosť <output data-desk-grid-output>'+Math.round(grid.opacity*100)+' %</output></span><input type="range" min="5" max="60" step="1" data-desk-grid="opacity" value="'+Math.round(grid.opacity*100)+'" aria-label="Viditeľnosť mriežky v percentách"></label><p>Mriežka sa uloží so stolom. Do PNG ju pridáš vo voľbách Súbory.</p></div></details>';
  }
  function canvasControls() {
    var current=canvases.find(function(c){return c.id===canvasId;});
    return '<div class="desk-canvases"><label>Kanvas <select data-desk-canvas aria-label="Uložený kanvas"><option value="main">Pôvodný spoločný stôl</option>'+canvases.map(function(c){return '<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>';}).join('')+'</select></label>'+button('new-canvas','Nový kanvas')+button('duplicate-canvas','Duplikovať kanvas')+'<div class="desk-canvas-name" '+(current?'':'hidden')+'><label>Názov <input type="text" maxlength="80" required data-desk-canvas-name aria-label="Názov kanvasu" value="'+esc(current?.name||'')+'"></label>'+button('rename-canvas','Premenovať')+'</div><div class="desk-storage"><label>Spoločné miesto <meter data-desk-storage min="0" max="10485760" low="0" high="9437184" optimum="0" value="0" aria-label="Využitie spoločného miesta všetkých kanvasov"></meter></label><span data-desk-storage-text></span><p data-desk-storage-warning hidden>Blížiš sa k limitu. Stiahni JSON zálohu; PNG nenahrádza dáta všetkých kanvasov. Pred ďalšími fotkami môžeš odstrániť nepotrebné objekty.</p></div><p class="desk-canvas-help">Pôvodný stôl zostáva zachovaný. JSON záloha obsahuje všetky kanvasy.</p></div>';
  }
  function mount() {
    var el=root();if(!el||!loaded)return;
    if(mounted===el && el.querySelector('.desk-board')) {updateStatus();return;}
    mounted=el;el.innerHTML='<header class="desk-heading"><div><p class="eyebrow">MIESTO PRE TVOJE NÁPADY</p><h1>Alchymistický stôl</h1><p>Lístky, obrázky a náčrty. Všetko na jednom mieste.</p></div><div class="desk-heading-actions"><span class="desk-save-status" role="status" aria-live="polite"></span>'+button('save','Uložiť teraz','aria-label="Uložiť alchymistický stôl"')+'</div></header>'+
      '<div class="desk-notice" hidden></div><div class="desk-toolbar" role="toolbar" aria-label="Nástroje stola"><div class="desk-tool-group">'+TOOLS.map(function(t){return button('tool','<span class="desk-tool-symbol" aria-hidden="true">'+t[1]+'</span><span>'+t[2]+'</span>','data-tool="'+t[0]+'" aria-pressed="'+(tool===t[0])+'" title="'+t[2]+'"');}).join('')+'</div><div class="desk-tool-group desk-paint-options"><label class="desk-color-label"><input type="color" data-desk-color value="'+color+'" aria-label="Farba kreslenia"><span>Farba</span></label><label class="desk-size-label">Hrúbka <input type="range" min="1" max="60" value="'+brushSize+'" data-desk-size aria-label="Hrúbka kreslenia"><output data-desk-size-output>'+brushSize+'</output></label></div><div class="desk-tool-group">'+button('note','＋ Lístok')+button('photo','▧ Fotka')+'</div><div class="desk-tool-group">'+button('undo','↶','aria-label="Späť" title="Späť (Ctrl+Z)"')+button('redo','↷','aria-label="Znova" title="Znova (Ctrl+Shift+Z)"')+'</div><div class="desk-tool-group desk-zoom"><label for="desk-zoom">Pohľad</label><select id="desk-zoom" aria-label="Priblíženie plátna"><option value="fit">Prispôsobiť</option><option value="0.5">50 %</option><option value="0.75">75 %</option><option value="1">100 %</option><option value="1.25">125 %</option><option value="1.5">150 %</option></select></div>'+gridControls()+'<details class="desk-file-menu"><summary>Súbory <span aria-hidden="true">⌄</span></summary><div><label class="desk-grid-png-option"><input type="checkbox" data-desk-grid-png> Zahrnúť mriežku do PNG</label>'+button('png','Exportovať obrázok PNG')+button('export','Záloha stola JSON')+button('import','Obnoviť stôl zo zálohy')+'</div></details></div>'+
      '<div class="desk-selection-bar"><span class="desk-selection-label">Vyber lístok alebo fotku. Kresli perom na voľnú plochu.</span><div class="desk-selection-actions" hidden><label class="desk-note-color-label">Papier <input type="color" data-desk-note-color aria-label="Farba vybraného lístka"></label>'+button('front','Dopredu','title="Presunúť nad ostatné"')+button('back','Dozadu','title="Presunúť pod ostatné"')+button('delete','Odstrániť','class="desk-danger"')+'</div></div>'+
      '<div class="desk-worktop"><div class="desk-viewport" tabindex="0" aria-label="Pracovná plocha. Vybraný lístok alebo fotku posunieš aj šípkami."><div class="desk-sizer"><div class="desk-board" data-tool="'+tool+'"><div class="desk-grid" aria-hidden="true"></div><svg xmlns="http://www.w3.org/2000/svg" class="desk-paint" aria-label="Kresliace plátno"></svg><div class="desk-items"></div></div></div></div></div><footer class="desk-footer"><span data-desk-dimensions></span><span>Ťahaj za horný okraj. Veľkosť meníš rohom. PNG najviac 4096 px; JSON zachová plné rozlíšenie.</span></footer><input type="file" data-desk-photos accept="image/png,image/jpeg,image/webp" multiple hidden><input type="file" data-desk-import accept="application/json,.json" hidden>';
    el.querySelector('.desk-toolbar').insertAdjacentHTML('beforeend',canvasControls());
    if(embedded&&el.dataset.sharedSurface==='true'){
      var controls=el.ownerDocument.createElement('div');controls.className='desk-shared-controls';
      Array.from(el.children).filter(function(child){return child.matches('.desk-heading,.desk-notice,.desk-toolbar,.desk-selection-bar,.desk-footer');}).forEach(function(child){controls.append(child);});
      if(externalControls) {
        externalControls.replaceChildren(controls);
        groupControls(controls);
      } else el.append(controls);
    }
    if(embedded&&el.dataset.panelWidth){el.querySelector('.desk-viewport').style.width=el.dataset.panelWidth+'px';el.querySelector('.desk-viewport').style.height=el.dataset.panelHeight+'px';}
    control('#desk-zoom').value=zoom; control('[data-desk-canvas]').value=canvasId; bind(el);if(externalControls)bind(externalControls);setScale();renderItems();draw();updateSelection();updateStatus();
    if(externalControls?.dataset.unifiedControls==='true')category(controlGroup);
    if(resizeObserver)resizeObserver.disconnect();if(window.ResizeObserver){resizeObserver=new ResizeObserver(function(){if(active&&zoom==='fit')setScale();});resizeObserver.observe(el.querySelector('.desk-viewport'));}
    var View=el.ownerDocument?.defaultView;if(View)el.dispatchEvent(new View.CustomEvent('mo-desk-ready',{bubbles:true,composed:true}));
  }
  function groupControls(controls) {
    var doc=controls.ownerDocument,toolbar=controls.querySelector('.desk-toolbar');
    var groups=Array.from(toolbar.querySelectorAll('.desk-tool-group'));
    var common=doc.createElement('div');common.className='desk-control-common';common.append(groups[3]);
    var switches=doc.createElement('nav');switches.className='desk-control-switches';switches.setAttribute('aria-label','Skupiny nástrojov stola');
    var panels=doc.createElement('div');
    var unified=externalControls?.dataset.unifiedControls==='true';
    var entries=unified
      ? [['drawing','Kreslenie',[groups[0],groups[1]]],['colors','Farby',[toolbar.querySelector('[data-desk-grid="color"]').closest('label'),controls.querySelector('.desk-note-color-label')]],['objects','Objekty',[groups[2],controls.querySelector('.desk-selection-bar')]],['view','Pohľad',[groups[4],toolbar.querySelector('.desk-grid-menu'),controls.querySelector('.desk-footer')]],['files','Súbory',[toolbar.querySelector('.desk-file-menu'),toolbar.querySelector('.desk-canvases')]]]
      : [['drawing','Kreslenie',[groups[0],groups[1]]],['objects','Objekty',[groups[2],controls.querySelector('.desk-selection-bar')]],['view','Pohľad',[groups[4],toolbar.querySelector('.desk-grid-menu'),controls.querySelector('.desk-footer')]],['files','Súbory',[toolbar.querySelector('.desk-file-menu'),toolbar.querySelector('.desk-canvases')]]];
    entries.forEach(function(entry){
      var id=entry[0],button=doc.createElement('button'),panel=doc.createElement('section');
      button.type='button';button.className='desk-button';button.textContent=entry[1];button.dataset.deskGroup=id;
      button.setAttribute('aria-controls','desk-control-'+id);button.setAttribute('aria-pressed',String(id===controlGroup));
      panel.id='desk-control-'+id;panel.className='desk-control-panel';panel.setAttribute('aria-label',entry[1]);panel.hidden=id!==controlGroup;
      entry[2].forEach(function(node){if(node.matches('details'))node.open=true;panel.append(node);});
      button.addEventListener('click',function(){
        controlGroup=id;
        switches.querySelectorAll('button').forEach(function(b){b.setAttribute('aria-pressed',String(b===button));});
        Array.from(panels.children).forEach(function(p){p.hidden=p!==panel;});
      });
      switches.append(button);panels.append(panel);
    });
    toolbar.replaceWith(common,switches,panels);
    if(unified){switches.hidden=true;common.dataset.deskHistory='';controls.querySelector('[data-desk-color]').closest('label').hidden=true;controls.querySelector('[data-desk-size]').closest('label').hidden=true;}
  }
  function category(value) {
    controlGroup=value;
    if(!externalControls)return;
    externalControls.querySelectorAll('.desk-control-panel').forEach(function(p){p.hidden=p.id!=='desk-control-'+value;});
    var common=externalControls.querySelector('.desk-control-common');if(common)common.hidden=value!=='history';
  }
  function emitBrush(value) {
    var el=root();if(!el)return;
    var View=el.ownerDocument?.defaultView;
    if(View)el.dispatchEvent(new View.CustomEvent('mo-desk-brush',{bubbles:true,composed:true,detail:value}));
  }
  function setBrush(value) {
    if(value.color!==undefined){if(!/^#[0-9a-f]{6}$/i.test(value.color))throw new Error('Neplatná farba.');color=value.color;}
    if(value.size!==undefined){if(!Number.isFinite(value.size)||value.size<1||value.size>60)throw new Error('Neplatná hrúbka.');brushSize=value.size;}
    if(value.tool!==undefined){if(!TOOLS.some(function(t){return t[0]===value.tool;}))throw new Error('Neplatný nástroj.');finishGesture();tool=value.tool;}
    var c=control('[data-desk-color]'),s=control('[data-desk-size]'),o=control('[data-desk-size-output]');
    if(c)c.value=color;if(s)s.value=brushSize;if(o)o.textContent=brushSize;
    updateSelection();
  }
  function bind(el) {
    if(el.dataset.deskBound)return;el.dataset.deskBound='true';
    el.addEventListener('click',function(e){if(embedded!==el&&externalControls!==el)return;var button=e.target.closest('[data-action]');if(button)run(handleAction(button.dataset.action,button));});
    el.addEventListener('pointerdown',pointerDown);el.addEventListener('pointermove',pointerMove);el.addEventListener('pointerup',pointerUp);el.addEventListener('pointercancel',pointerCancel);
    el.addEventListener('input',function(e){
      if(e.target.matches('[data-desk-color]')){color=e.target.value;emitBrush({color:color});}
      else if(e.target.matches('[data-desk-size]')){brushSize=Number(e.target.value);control('[data-desk-size-output]').textContent=brushSize;emitBrush({size:brushSize});}
      else if(e.target.matches('[data-desk-grid="opacity"]'))control('[data-desk-grid-output]').textContent=e.target.value+' %';
      else if(e.target.matches('.desk-note-text')){
        try{writable();var id=e.target.closest('[data-desk-item]').dataset.deskItem;beginText(id);var item=find(id);if(item){var previous=item.text;item.text=e.target.value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');try{state=validateCanvas(state);}catch(error){item.text=previous;e.target.value=previous;throw error;}if(e.target.value!==item.text)e.target.value=item.text;changed();}}catch(error){notify(error.message);}
      }
    });
    el.addEventListener('change',function(e){
      if(e.target.matches('[data-desk-canvas]'))run(switchCanvas(e.target.value));
      else if(e.target.matches('#desk-zoom')){zoom=e.target.value;setScale();}
      else if(e.target.matches('[data-desk-grid]')){var key=e.target.dataset.deskGrid;run(changeGrid(key,key==='enabled'?e.target.checked:key==='spacing'?Number(e.target.value):key==='opacity'?Number(e.target.value)/100:e.target.value));}
      else if(e.target.matches('[data-desk-grid-png]'))includeGridPNG=e.target.checked;
      else if(e.target.matches('[data-desk-note-color]'))run(changeNoteColor(e.target.value));
      else if(e.target.matches('[data-desk-photos]')){var files=Array.from(e.target.files);e.target.value='';run(addPhotos(files));}
      else if(e.target.matches('[data-desk-import]')){var f=e.target.files[0];e.target.value='';if(f)run(importFile(f));}
    });
    el.addEventListener('focusin',function(e){if(e.target.matches('.desk-note-text')){var id=e.target.closest('[data-desk-item]').dataset.deskItem;select(id);beginText(id);}});
    el.addEventListener('focusout',function(e){if(e.target.matches('.desk-note-text'))finishText();});
    el.addEventListener('keydown',keyDown);
    el.addEventListener('keydown',function(e){if(e.target.matches('[data-desk-canvas-name]')&&e.key==='Enter'){e.preventDefault();run(renameCanvas(e.target.value));}});
  }
  function find(id) { return state && state.items.find(function(i){return i.id===id;}); }
  function setScale() {
    var el=root();if(!el||!loaded)return;var viewport=el.querySelector('.desk-viewport'),board=el.querySelector('.desk-board'),sizer=el.querySelector('.desk-sizer');if(!viewport||!board)return;
    var dimensions=embedded?10000:state.width,height=embedded?10000:state.height;scale=zoom==='fit'?Math.max(.02,Math.min(1,(viewport.clientWidth-36)/dimensions)):Number(zoom);sizer.style.width=(dimensions*scale)+'px';sizer.style.height=(height*scale)+'px';board.style.width=dimensions+'px';board.style.height=height+'px';board.style.transform='scale('+scale+')';
  }
  function itemNode(item) {
    var node=document.createElement('article');node.className='desk-item desk-'+item.type;node.dataset.deskItem=item.id;node.tabIndex=0;node.setAttribute('aria-label',item.type==='note'?'Nalepovací lístok':'Fotka: '+item.name);
    node.innerHTML='<div class="desk-item-handle" data-desk-handle><span class="desk-tape" aria-hidden="true"></span><span class="desk-item-caption">'+(item.type==='note'?'LÍSTOK':esc(item.name))+'</span><span class="desk-move-dots" aria-hidden="true">⠿</span></div>'+(item.type==='note'?'<textarea class="desk-note-text" maxlength="5000" placeholder="Čo ti chodí hlavou…" aria-label="Text lístka" spellcheck="true"></textarea>':'<img draggable="false" alt="'+esc(item.name)+'">')+'<button type="button" class="desk-resize" data-desk-resize aria-label="Zmeniť veľkosť. Vyber objekt a potiahni tento roh." title="Potiahni pre zmenu veľkosti"></button>';
    if(item.type==='note')node.querySelector('textarea').value=item.text;else node.querySelector('img').src=item.src;positionNode(node,item);return node;
  }
  function positionNode(node,item) { node.style.left=item.x+'px';node.style.top=item.y+'px';node.style.width=item.width+'px';node.style.height=item.height+'px';node.style.zIndex=item.z;node.style.setProperty('--paper',item.type==='note'?item.color:'#fff9ed');node.classList.toggle('desk-selected',item.id===selected); }
  function renderItems() { var host=root()&&root().querySelector('.desk-items');if(!host||!state)return;host.replaceChildren();state.items.forEach(function(item){host.appendChild(itemNode(item));}); }
  function select(id) { if(id!==selected){finishText();selected=id;updateSelection();} }
  function updateSelection() {
    var el=root();if(!el)return;var item=find(selected),label=control('.desk-selection-label'),actions=control('.desk-selection-actions');
    el.querySelectorAll('[data-desk-item]').forEach(function(node){node.classList.toggle('desk-selected',node.dataset.deskItem===selected);});
    if(label)label.textContent=item?(item.type==='note'?'Nalepovací lístok':'Fotka: '+item.name):'Vyber lístok alebo fotku. Kresli perom na voľnú plochu.';
    if(actions)actions.hidden=!item;
    var colorLabel=control('.desk-note-color-label');if(colorLabel){colorLabel.hidden=!item||item.type!=='note';if(item&&item.type==='note')colorLabel.querySelector('input').value=item.color;}
    var back=control('[data-action="desk-undo"]'),forward=control('[data-action="desk-redo"]');if(back)back.disabled=!undo.length&&!textEdit;if(forward)forward.disabled=!redo.length;
    toolButtons().forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.tool===tool));});var board=el.querySelector('.desk-board');if(board)board.dataset.tool=tool;
  }
  function saveStatusText() { return saving?'Ukladám…':conflict?'Zmeny v inom okne':lastError?'Neuložené · skús znova':dirty?'Pripravené na uloženie':'Uložené'+(updatedAt?' · '+new Date(updatedAt).toLocaleTimeString('sk-SK',{hour:'2-digit',minute:'2-digit'}):''); }
  function updateStorage() {
    var meter=control('[data-desk-storage]');if(!meter||!state)return;
    var key=generation+':'+canvasEpoch+':'+sequence;
    if(!usageCache||usageCache.key!==key)usageCache={key:key,bytes:new TextEncoder().encode(JSON.stringify(snapshot())).length};
    var bytes=usageCache.bytes,percent=bytes/10485760*100;
    var text=(bytes/1048576).toLocaleString('sk-SK',{minimumFractionDigits:2,maximumFractionDigits:2})+' / 10 MiB · '+percent.toLocaleString('sk-SK',{maximumFractionDigits:1})+' % · '+(canvases.length+1)+' / 21 plôch';
    meter.value=bytes;meter.setAttribute('aria-valuetext',text);meter.title=bytes.toLocaleString('sk-SK')+' / 10 485 760 bajtov';
    control('[data-desk-storage-text]').textContent=text;
    control('[data-desk-storage-warning]').hidden=percent<90;
  }
  function updateStatus() {
    var el=root();if(!el)return;var status=control('.desk-save-status'),notice=control('.desk-notice');if(status){status.textContent=saveStatusText();status.dataset.status=conflict||lastError?'error':dirty||saving?'pending':'saved';}
    updateStorage();
    if(notice){var message=conflict?'Stôl na serveri sa medzitým zmenil. Tvoje úpravy sú zachované v tomto prehliadači. Najprv si ich môžeš stiahnuť a potom načítať uložený stôl.':lastError?lastError:cacheFailed?'Prehliadač nemá dosť miesta na lokálnu kópiu. Ulož stôl na server alebo si stiahni zálohu.':'';notice.hidden=!message;notice.innerHTML=message?'<p role="alert">'+esc(message)+'</p><div>'+button('export','Stiahnuť moju zálohu')+(conflict?button('cloud','Načítať stôl zo servera'):button('save','Skúsiť uložiť znova'))+'</div>':'';}
  }
  function pushHistory(before) {undo.push(before);if(undo.length>30)undo.shift();redo=[];updateSelection();}
  function mutate(fn) { writable();finishGesture();finishText();var before=copy(state),draft=prepareEmbedded(copy(state));fn(draft);state=validateCanvas(draft);pushHistory(before);changed();renderItems();draw();updateSelection(); }
  function changed() { dirty=true;lastError='';sequence++;cacheCurrent();scheduleSave();updateStatus(); }
  function scheduleSave() { clearTimeout(saveTimer);if(!conflict)saveTimer=setTimeout(function(){run(flush());},900); }
  function beginText(id) { if(textEdit&&textEdit.id===id)return;finishText();textEdit={id:id,before:copy(state)};state=copy(state); }
  function finishText() { if(!textEdit)return;var before=textEdit.before,id=textEdit.id;textEdit=null;var old=before.items.find(function(i){return i.id===id;}),now=find(id);if(old&&now&&old.text!==now.text)pushHistory(before);updateSelection(); }
  async function flush() {
    finishGesture();finishText();clearTimeout(saveTimer);saveTimer=null;
    if(!loaded || !dirty)return;
    if(conflict)throw new Error('Stôl sa zmenil v inom okne. Stiahni zálohu alebo načítaj stôl zo servera.');
    if(saving){await saving;if(dirty)return flush();return;}
    var gen=generation,id=accountId;
    saving=(async function(){
      while(dirty && !conflict){
        if(gen!==generation||id!==accountId||!user()||user().id!==id)throw stale();
        var sent=sequence,sentState=model().validateState(snapshot()),base=revision;
        await cacheCurrent();
        if(gen!==generation||id!==accountId||!user()||user().id!==id)throw stale();
        try {var result=await api({method:'PUT',body:{state:sentState,expectedRevision:base}});if(gen!==generation||id!==accountId)throw stale();revision=result.revision;updatedAt=result.updatedAt;savedSequence=sent;dirty=sequence!==sent;lastError='';await cacheCurrent();}
        catch(e){if(gen!==generation||e.code==='STALE_DESK')throw e;if(e.status===409)conflict=true;lastError=e.message||'Stôl sa nepodarilo uložiť. Tvoje zmeny zostávajú v prehliadači.';await cacheCurrent();throw e;}
      }
    })();updateStatus();
    try {await saving;}catch(error){if(gen===generation&&error.code!=='STALE_DESK'){lastError=error.message||'Stôl sa nepodarilo uložiť.';updateStatus();}throw error;}finally{if(gen===generation){saving=null;updateStatus();}}
  }
  function world(e) {var rect=root().querySelector('.desk-board').getBoundingClientRect();return{x:Math.max(0,Math.min(embedded?10000:state.width,(e.clientX-rect.left)/scale)),y:Math.max(0,Math.min(embedded?10000:state.height,(e.clientY-rect.top)/scale))};}
  function pointerDown(e) {
    if(!loaded||switchingCanvas||e.button!==0||gesture)return;var board=e.target.closest('.desk-board');if(!board)return;
    try{writable();}catch(error){notify(error.message);return;}
    var node=e.target.closest('[data-desk-item]');
    if(node){select(node.dataset.deskItem);var item=find(selected);if(e.target.closest('[data-desk-handle]')||e.target.closest('[data-desk-resize]')||(item.type==='image'&&!e.target.closest('button'))){e.preventDefault();finishText();var p=world(e);gesture={type:e.target.closest('[data-desk-resize]')?'resize':'move',pointer:e.pointerId,start:p,original:Object.assign({},item),before:copy(state),node:node};state=copy(state);board.setPointerCapture(e.pointerId);}}
    else{select('');finishText();e.preventDefault();if(tool==='select'){var viewport=root().querySelector('.desk-viewport');gesture={type:'pan',pointer:e.pointerId,startX:e.clientX,startY:e.clientY,left:viewport.scrollLeft,top:viewport.scrollTop,viewport:viewport};}else{var point=world(e);gesture={type:'stroke',pointer:e.pointerId,stroke:{id:uid(),tool:tool,color:color,size:brushSize,points:[point]},board:board};draw();}board.setPointerCapture(e.pointerId);}
  }
  function pointerMove(e) {
    if(!gesture||gesture.pointer!==e.pointerId)return;e.preventDefault();var g=gesture;if(g.type==='pan'){g.viewport.scrollLeft=g.left-(e.clientX-g.startX);g.viewport.scrollTop=g.top-(e.clientY-g.startY);return;}var p=world(e);
    if(g.type==='stroke'){var points=g.stroke.points,last=points[points.length-1];if(g.stroke.tool==='pen'||g.stroke.tool==='eraser'){if(Math.hypot(p.x-last.x,p.y-last.y)>=1&&points.length<10000)points.push(p);}else{if(points.length===1)points.push(p);else points[1]=p;}draw();}
    else{var item=find(g.original.id),dx=p.x-g.start.x,dy=p.y-g.start.y,width=embedded?10000:state.width,height=embedded?10000:state.height;if(g.type==='move'){item.x=Math.max(0,Math.min(width-item.width,g.original.x+dx));item.y=Math.max(0,Math.min(height-item.height,g.original.y+dy));}else{item.width=Math.max(80,Math.min(width-item.x,g.original.width+dx));item.height=Math.max(80,Math.min(height-item.y,g.original.height+dy));}positionNode(g.node,item);}
  }
  function pointerUp(e){if(gesture&&gesture.pointer===e.pointerId){e.preventDefault();finishGesture();}}
  function pointerCancel(e){if(gesture&&gesture.pointer===e.pointerId){if(gesture.type==='move'||gesture.type==='resize'){state=gesture.before;renderItems();}gesture=null;draw();}}
  function finishGesture() {
    if(!gesture)return;var g=gesture;gesture=null;
    if(g.type==='pan')return;
    if(g.type==='stroke'){try{writable();var before=copy(state),draft=prepareEmbedded(copy(state));draft.strokes.push(g.stroke);state=validateCanvas(draft);pushHistory(before);changed();}catch(e){notify(e.message);}draw();}
    else{var old=g.original,item=find(old.id);if(item&&(old.x!==item.x||old.y!==item.y||old.width!==item.width||old.height!==item.height)){try{state=validateCanvas(prepareEmbedded(state));pushHistory(g.before);changed();}catch(e){state=g.before;renderItems();notify(e.message);}}}
  }
  function stroke(ctx,s) {
    var pts=s.points,a=pts[0],b=pts[pts.length-1];ctx.save();ctx.globalCompositeOperation=s.tool==='eraser'?'destination-out':'source-over';ctx.strokeStyle=s.color;ctx.fillStyle=s.color;ctx.lineWidth=s.size;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();
    if(s.tool==='rect')ctx.rect(a.x,a.y,b.x-a.x,b.y-a.y);else if(s.tool==='ellipse')ctx.ellipse((a.x+b.x)/2,(a.y+b.y)/2,Math.abs(b.x-a.x)/2,Math.abs(b.y-a.y)/2,0,0,Math.PI*2);else{ctx.moveTo(a.x,a.y);pts.slice(1).forEach(function(p){ctx.lineTo(p.x,p.y);});}
    if(pts.length===1){ctx.arc(a.x,a.y,s.size/2,0,Math.PI*2);ctx.fill();}else ctx.stroke();ctx.restore();
  }
  function paintGrid(ctx,value) {
    var grid=gridOf(value);if(!grid.enabled)return;ctx.save();ctx.globalAlpha=grid.opacity;ctx.strokeStyle=grid.color;ctx.fillStyle=grid.color;ctx.lineWidth=1;ctx.beginPath();
    if(grid.style==='lines'){for(var x=0;x<value.width;x+=grid.spacing){ctx.moveTo(x+.5,0);ctx.lineTo(x+.5,value.height);}for(var y=0;y<value.height;y+=grid.spacing){ctx.moveTo(0,y+.5);ctx.lineTo(value.width,y+.5);}ctx.stroke();}
    else{for(var dx=0;dx<value.width;dx+=grid.spacing)for(var dy=0;dy<value.height;dy+=grid.spacing){ctx.moveTo(dx+1,dy);ctx.arc(dx,dy,1,0,Math.PI*2);}ctx.fill();}ctx.restore();
  }
  function updateGridControls() {
    var el=root();if(!el||!state)return;var grid=gridOf(state);
    ['enabled','spacing','style','color','opacity'].forEach(function(key){var input=control('[data-desk-grid="'+key+'"]');if(!input)return;if(key==='enabled')input.checked=grid.enabled;else input.value=key==='opacity'?Math.round(grid.opacity*100):grid[key];});
    var output=control('[data-desk-grid-output]');if(output)output.textContent=Math.round(grid.opacity*100)+' %';var png=control('[data-desk-grid-png]');if(png){png.checked=includeGridPNG;png.disabled=!grid.enabled;}
  }
  async function changeGrid(key,value){try{mutate(function(d){d.grid=gridOf(d);d.grid[key]=value;});}finally{updateGridControls();}}
  function draw() {
    var el=root(),surface=el&&el.querySelector('.desk-paint');if(!surface||!state)return;
    var view=displayed();setScale();el.querySelector('.desk-board').style.backgroundColor=view.background;
    var grid=el.querySelector('.desk-grid'),settings=gridOf(state);
    grid.style.backgroundImage=settings.enabled?(settings.style==='dots'?'radial-gradient(circle at 1px 1px, '+settings.color+' 1px, transparent 1.5px)':'linear-gradient('+settings.color+' 1px, transparent 1px),linear-gradient(90deg,'+settings.color+' 1px, transparent 1px)'):'none';
    grid.style.backgroundSize=settings.spacing+'px '+settings.spacing+'px';grid.style.opacity=settings.opacity;
    window.MODeskVector.paint(surface,view,gesture&&gesture.type==='stroke'?gesture.stroke:null);
    control('[data-desk-dimensions]').textContent='✦ '+view.width+' × '+view.height+' · '+(canvasId==='main'?'Spoločný stôl účtu':canvases.find(function(c){return c.id===canvasId;}).name)+(embedded&&state.width!==10000?' · Pôvodný stôl sa rozšíri až pri vašej úprave.':'');
    updateGridControls();
  }
  function keyDown(e) {
    if(e.target.matches('textarea,input,select,[contenteditable="true"]'))return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();run(handleAction(e.shiftKey?'desk-redo':'desk-undo'));return;}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();run(flush());return;}
    if(selected&&(e.key==='Delete'||e.key==='Backspace')){e.preventDefault();run(handleAction('desk-delete'));return;}
    var delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];if(selected&&delta){e.preventDefault();mutate(function(d){var i=d.items.find(function(v){return v.id===selected;}),step=e.shiftKey?10:2;if(e.altKey){i.width=Math.max(80,Math.min(d.width-i.x,i.width+delta[0]*step));i.height=Math.max(80,Math.min(d.height-i.y,i.height+delta[1]*step));}else{i.x=Math.max(0,Math.min(d.width-i.width,i.x+delta[0]*step));i.y=Math.max(0,Math.min(d.height-i.height,i.y+delta[1]*step));}});root().querySelector('[data-desk-item="'+selected+'"]')?.focus();}
  }
  function addNote() {var id=uid();mutate(function(d){if(d.items.filter(function(i){return i.type==='note';}).length>=100)throw new Error('Na stole môže byť najviac 100 lístkov.');var offset=(d.items.length%10)*28;d.items.push({id:id,type:'note',x:110+offset,y:110+offset,width:285,height:260,z:nextZ(d),color:COLORS[d.items.filter(function(i){return i.type==='note';}).length%COLORS.length],text:''});});selected=id;tool='select';updateSelection();var n=root().querySelector('[data-desk-item="'+id+'"]');if(n){n.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});n.querySelector('textarea').focus();} }
  function nextZ(d){var maximum=Math.max(0,...d.items.map(function(i){return i.z;}));if(maximum>=100000){d.items.slice().sort(function(a,b){return a.z-b.z;}).forEach(function(i,n){i.z=n+1;});maximum=d.items.length;}return maximum+1;}
  async function changeNoteColor(value){if(find(selected)?.type==='note')mutate(function(d){d.items.find(function(i){return i.id===selected;}).color=value;});}
  function dataImage(file){return new Promise(function(resolve,reject){if(!['image/png','image/jpeg','image/webp'].includes(file.type))return reject(new Error('Vyber fotku PNG, JPG alebo WebP.'));if(file.size>25*1024*1024)return reject(new Error('Fotka môže mať najviac 25 MB.'));var url=URL.createObjectURL(file),img=new Image();img.onload=function(){try{var ratio=Math.min(1,1200/Math.max(img.naturalWidth,img.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(img.naturalHeight*ratio));var ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);resolve({src:canvas.toDataURL('image/jpeg',.86),width:canvas.width,height:canvas.height});}catch(e){reject(new Error('Obrázok sa nepodarilo pripraviť.'));}finally{URL.revokeObjectURL(url);}};img.onerror=function(){URL.revokeObjectURL(url);reject(new Error('Obrázok sa nepodarilo otvoriť.'));};img.src=url;});}
  async function addPhotos(files){var context=canvasContext();if(!files.length)return;if(files.length+state.items.filter(function(i){return i.type==='image';}).length>20)throw new Error('Na stole môže byť najviac 20 fotografií.');notify('Pripravujem fotky…');var added=[];for(var f of files){var image=await dataImage(f);added.push({file:f,image:image});}checkCanvas(context);var last='';mutate(function(d){added.forEach(function(entry){var size=420,ratio=entry.image.width/entry.image.height,width=ratio>=1?size:Math.max(80,size*ratio),height=ratio>=1?Math.max(80,size/ratio):size,offset=d.items.length%10*24;last=uid();d.items.push({id:last,type:'image',x:150+offset,y:100+offset,width:width,height:height,z:nextZ(d),src:entry.image.src,name:entry.file.name.slice(0,160)});});});selected=last;tool='select';updateSelection();notify('Fotky sú na stole.');}
  function download(content,type,name){var blob=content instanceof Blob?content:new Blob([content],{type:type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},30000);}
  function exportJSON(){finishGesture();finishText();if(!state)return;download(JSON.stringify({format:'magnum-opus-desk',exportedAt:new Date().toISOString(),state:model().validateState(snapshot())},null,2),'application/json','magnum-opus-alchymisticky-stol.json');}
  async function importFile(file){endInteraction();var context=canvasContext();if(file.size>12*1024*1024)throw new Error('Záloha je príliš veľká. Limit je 12 MB.');var data=JSON.parse(await file.text()),clean=model().validateState(data.state||data);checkCanvas(context,true);if(!window.confirm(clean.canvases?'Nahradiť pôvodný stôl aj všetky kanvasy zo zálohy? Najprv si stiahni súčasnú JSON zálohu.':'Nahradiť aktuálny kanvas zo zálohy? Ostatné kanvasy zostanú. Najprv si môžeš stiahnuť súčasnú verziu.'))return;checkCanvas(context,true);if(clean.canvases){endInteraction();restoreLibrary(clean);undo=[];redo=[];changed();mounted=null;mount();}else{mutate(function(d){Object.assign(d,clean);});canvasEpoch++;}selected='';updateSelection();notify('Stôl je obnovený zo zálohy.');}
  function loadImage(src){if(images.has(src))return images.get(src);var promise=new Promise(function(resolve,reject){var img=new Image();img.onload=function(){resolve(img);};img.onerror=function(){reject(new Error('Fotku sa nepodarilo zahrnúť do obrázka.'));};img.src=src;});images.set(src,promise);return promise;}
  function wrapText(ctx,text,width){var lines=[];text.split('\n').forEach(function(paragraph){if(!paragraph){lines.push('');return;}var line='';Array.from(paragraph).forEach(function(c){if(ctx.measureText(line+c).width>width&&line){lines.push(line);line=c;}else line+=c;});lines.push(line);});return lines;}
  async function exportPNG(){
    finishGesture();finishText();
    var snapshot=copy(displayed()),ratio=Math.min(1,4096/Math.max(snapshot.width,snapshot.height)),canvas=document.createElement('canvas');
    canvas.width=Math.round(snapshot.width*ratio);canvas.height=Math.round(snapshot.height*ratio);
    var ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);ctx.fillStyle=snapshot.background;ctx.fillRect(0,0,snapshot.width,snapshot.height);
    if(includeGridPNG)paintGrid(ctx,snapshot);
    var layer=document.createElement('canvas');layer.width=canvas.width;layer.height=canvas.height;
    var paintCtx=layer.getContext('2d');paintCtx.scale(ratio,ratio);snapshot.strokes.forEach(function(s){stroke(paintCtx,s);});
    ctx.drawImage(layer,0,0,snapshot.width,snapshot.height);
    for(var item of snapshot.items.slice().sort(function(a,b){return a.z-b.z;})){
      ctx.save();ctx.translate(item.x,item.y);ctx.shadowColor='#30251533';ctx.shadowBlur=12;ctx.shadowOffsetY=5;ctx.fillStyle=item.type==='note'?item.color:'#fff9ed';ctx.fillRect(0,0,item.width,item.height);ctx.shadowColor='transparent';ctx.beginPath();ctx.rect(0,0,item.width,item.height);ctx.clip();
      if(item.type==='note'){ctx.fillStyle='#353344';ctx.font='22px "Segoe UI", sans-serif';ctx.textBaseline='top';var lines=wrapText(ctx,item.text,item.width-40);lines.forEach(function(line,i){if(48+i*31<item.height-12)ctx.fillText(line,20,48+i*31);});ctx.fillStyle='#fff8c0aa';ctx.fillRect(item.width/2-40,0,80,22);}
      else{var img=await loadImage(item.src),rw=item.width-20,rh=item.height-44,fit=Math.min(rw/img.naturalWidth,rh/img.naturalHeight),w=img.naturalWidth*fit,h=img.naturalHeight*fit;ctx.drawImage(img,(item.width-w)/2,34+(rh-h)/2,w,h);}
      ctx.restore();
    }
    var blob=await new Promise(function(resolve){canvas.toBlob(resolve,'image/png');});if(!blob)throw new Error('Obrázok sa nepodarilo vytvoriť.');download(blob,'image/png','magnum-opus-stol.png');notify('PNG '+canvas.width+' × '+canvas.height+' je pripravené. Plné dáta zachová záloha JSON.');
  }
  async function cloudReload(){endInteraction();var context=canvasContext();if(!window.confirm('Načítať uložený stôl a všetky kanvasy zo servera? Rozpracované zmeny tým nahradíš. Ak ich chceš ponechať, najprv stiahni zálohu.'))return;if(saving)await saving;checkCanvas(context,true);var data=await api();checkCanvas(context,true);restoreLibrary(data.state);revision=data.revision;updatedAt=data.updatedAt;dirty=false;conflict=false;lastError='';sequence++;undo=[];redo=[];selected='';await cacheCurrent();if(context.generation!==generation)throw stale();mounted=null;mount();}
  async function renameCanvas(name) {
    writable();
    var current=canvases.find(function(c){return c.id===canvasId;});
    if(!current)throw new Error('Pôvodný spoločný stôl nepremenúvame. Najprv vytvor alebo duplikuj kanvas.');
    if(typeof name!=='string'||!name.trim()||name.length>80||/[\u0000-\u001f]/.test(name))throw new Error('Zadaj názov od 1 do 80 znakov bez riadiacich znakov.');
    name=name.trim();if(name===current.name)return;
    if(canvases.some(function(c){return c.id!==canvasId&&c.name.toLocaleLowerCase('sk')===name.toLocaleLowerCase('sk');}))throw new Error('Iný kanvas už používa tento názov.');
    endInteraction();switchingCanvas=true;var gen=generation;
    try {
      await flush();if(gen!==generation)throw stale();
      var candidate=snapshot();candidate.canvases.find(function(c){return c.id===canvasId;}).name=name;
      model().validateState(candidate);
      current.name=name;changed();mounted=null;mount();await flush();
    } finally {if(gen===generation)switchingCanvas=false;}
  }
  async function switchCanvas(id, create) {
    writable();
    if(switchingCanvas)throw new Error('Počkaj na uloženie a prepnutie kanvasu.');
    if(!create&&id!== 'main'&&!canvases.some(function(c){return c.id===id;}))throw new Error('Kanvas neexistuje.');
    if(create&&canvases.length>=20)throw new Error('Najviac 20 ďalších kanvasov; spoločný limit uloženia je 10 MB.');
    endInteraction();switchingCanvas=true;var gen=generation;
    try {
      await flush();if(gen!==generation)throw stale();
      rememberCanvas();canvasHistory.set(canvasId,{undo:undo,redo:redo});
      if(create){
        id=uid();
        var sourceName=canvasId==='main'?'Pôvodný stôl':canvases.find(function(c){return c.id===canvasId;}).name;
        var nextState=create==='duplicate'?copy(state):model().createState();
        if(create==='duplicate'){nextState.items.forEach(function(item){item.id=uid();});nextState.strokes.forEach(function(stroke){stroke.id=uid();});}
        var entry={id:id,name:nextCanvasName(create==='duplicate'?sourceName+' – kópia':'Kanvas '+(canvases.length+1)),state:nextState};
        var candidate=snapshot();candidate.canvases=(candidate.canvases||[]).concat([entry]);model().validateState(candidate);
        canvases.push(entry);
      }
      canvasEpoch++;
      canvasId=id;state=copy(id==='main'?primary:canvases.find(function(c){return c.id===id;}).state);
      var history=canvasHistory.get(id);undo=history?history.undo:[];redo=history?history.redo:[];selected='';images.clear();mounted=null;
      if(create)changed();
      mount();
      if(create)await flush();
    } finally {if(gen===generation){switchingCanvas=false;var select=control('[data-desk-canvas]');if(select)select.value=canvasId;}}
  }
  async function handleAction(action,el){
    if(!action||!action.startsWith('desk-'))return false;
    if(action==='desk-retry'){load();return true;}
    if(action==='desk-export-damaged'&&damagedDraft&&damagedDraft.accountId===accountId){download(JSON.stringify(damagedDraft.record,null,2),'application/json','magnum-opus-stol-povodne-udaje.json');return true;}
    if(action==='desk-discard-damaged'&&damagedDraft&&damagedDraft.accountId===accountId){if(!window.confirm('Pokračovať so stolom zo servera? Pôvodné lokálne údaje budú nahradené.'))return true;var gen=generation,id=accountId;await cacheRemove(id);if(gen!==generation||id!==accountId)throw stale();held.delete(id);damagedDraft=null;load();return true;}
    if(!loaded)return true;
    if(switchingCanvas)throw new Error('Počkaj na uloženie a prepnutie kanvasu.');
    if(action==='desk-new-canvas'){await switchCanvas(null,true);return true;}
    if(action==='desk-duplicate-canvas'){await switchCanvas(null,'duplicate');return true;}
    if(action==='desk-rename-canvas'){await renameCanvas(control('[data-desk-canvas-name]').value);return true;}
    if(action==='desk-save'){await flush();notify('Stôl je uložený.');return true;}
    if(action==='desk-export'){exportJSON();return true;}if(action==='desk-png'){await exportPNG();return true;}if(action==='desk-cloud'){await cloudReload();return true;}
    writable();
    if(action==='desk-tool'){finishGesture();finishText();tool=el.dataset.tool;updateSelection();emitBrush({tool:tool});}
    else if(action==='desk-note')addNote();
    else if(action==='desk-photo')root().querySelector('[data-desk-photos]').click();
    else if(action==='desk-import')root().querySelector('[data-desk-import]').click();
    else if(action==='desk-delete'&&selected){var id=selected;mutate(function(d){d.items=d.items.filter(function(i){return i.id!==id;});});selected='';updateSelection();}
    else if((action==='desk-front'||action==='desk-back')&&selected)mutate(function(d){var ordered=d.items.slice().sort(function(a,b){return a.z-b.z;}),item=ordered.find(function(i){return i.id===selected;});ordered=ordered.filter(function(i){return i.id!==selected;});if(action==='desk-front')ordered.push(item);else ordered.unshift(item);ordered.forEach(function(i,n){i.z=n+1;});});
    else if(action==='desk-undo'||action==='desk-redo'){finishGesture();finishText();var from=action==='desk-undo'?undo:redo,to=action==='desk-undo'?redo:undo;if(from.length){var restored=validateCanvas(from[from.length-1]);to.push(copy(state));state=restored;from.pop();if(!find(selected))selected='';changed();renderItems();draw();updateSelection();}}
    return true;
  }
  function afterRender(view){active=!!embedded||view==='desk';if(!active){finishGesture();finishText();if(resizeObserver)resizeObserver.disconnect();return;}if(!syncAccount())return;if(!loaded){if(!loading)load();}else mount();}
  function embed(target,controls){finishGesture();finishText();if(externalControls)externalControls.replaceChildren();embedded=target;externalControls=target?controls||null:null;mounted=null;if(target){zoom='1';color='#ffffff';brushSize=2;tool='pen';afterRender('desk');}}
  function endInteraction(){
    var pointer=gesture?.pointer,board=root()?.querySelector('.desk-board');
    finishGesture();finishText();
    if(board&&pointer!==undefined&&board.hasPointerCapture(pointer))board.releasePointerCapture(pointer);
  }
  function destroy(options){options=options||{};finishGesture();finishText();var id=accountId;if(id&&state&&dirty&&options.preserveDraft){held.set(id,{state:snapshot(),revision:revision,updatedAt:updatedAt,pending:true});cacheCurrent();}else if(id&&!dirty)cacheRemove(id);active=false;if(resizeObserver)resizeObserver.disconnect();reset();accountId='';}
  function hasUnsavedDrafts(){return !!(dirty||gesture&&gesture.type!=='pan'||textEdit&&find(textEdit.id)?.text!==textEdit.before.items.find(function(i){return i.id===textEdit.id;})?.text);}
  window.addEventListener('beforeunload',function(e){if(hasUnsavedDrafts()){cacheCurrent();e.preventDefault();e.returnValue='';}});
  window.addEventListener('online',function(){if(dirty&&!conflict&&user())run(flush());});
  window.addEventListener('blur',function(){if(gesture)finishGesture();});
  window.MODesk={render:render,embed:embed,afterRender:afterRender,handleAction:handleAction,destroy:destroy,flush:flush,hasUnsavedDrafts:hasUnsavedDrafts,endInteraction:endInteraction,setBrush:setBrush,category:category,switchCanvas:switchCanvas,renameCanvas:renameCanvas};
})();
