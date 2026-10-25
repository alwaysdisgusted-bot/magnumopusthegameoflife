(() => {
  'use strict';
  const catalog = window.MOQuoteCatalog;
  const Authors=window.MOQuoteAuthors||{authors:[],of:()=>'original',bust:()=>''};
  let authorFilter='';
  let accountId = '', generation = 0, ready = false, attempted = false, error = '', busy = false;
  let settings = {enabled:true,idleMinutes:5}, saved = new Set(), currentView = '', filter = 'saved';
  let lastActivity = Date.now(), lastQuote = '', timer = null;
  const A=()=>window.MOApp, auth=()=>window.MOAuth, esc=v=>A().esc(v);
  const verification=q=>({verified:'Autor a dielo overené',paraphrase:'Parafráza',personal:'Osobný zápis'}[q.verification]||'Autorstvo neoverené');
  const sourceMarkup=(q,linkBooks=false)=>window.MOQuoteSources?.workMarkup(q,{books:linkBooks?A().state?.books||[]:[],linkBooks})||'';
  const account=()=>auth().getAccount();
  const activity=()=>{lastActivity=Date.now();};
  function destroy() {
    generation++; accountId='';ready=false;attempted=false;error='';busy=false;saved=new Set();
    settings={enabled:true,idleMinutes:5};currentView='';lastQuote='';filter='saved';authorFilter='';
    clearInterval(timer);timer=null;
  }
  function sync() {
    const id=account()?.id||'';
    if(id!==accountId){destroy();accountId=id;activity();}
    return !!id;
  }
  async function request(path, options) {
    const gen=generation,id=accountId,result=await auth().api(path,options);
    if(gen!==generation||account()?.id!==id)throw new Error('Prihlásenie sa zmenilo.');
    return result;
  }
  async function load() {
    if(attempted||!accountId)return;
    attempted=true;const gen=generation;
    try {
      const [prefs,collection]=await Promise.all([request('/api/quotes/settings'),request('/api/quotes/saved')]);
      if(gen!==generation)return;
      settings=prefs;saved=new Set(collection.saved.map(q=>q.quoteId));ready=true;error='';
    } catch(e){if(gen!==generation)return;error=e.message;}
    if(['profile','quotes'].includes(currentView))A().render();
  }
  function controls() {
    sync();
    return `<section class="card quote-profile-panel"><div><p class="eyebrow">MYŠLIENKA NA ZASTAVENIE</p><h2>Citáty a vlastná zbierka</h2><p class="muted">${ready?(settings.enabled?`Na profile sa po ${settings.idleMinutes} min. neaktivity objaví citát.`:'Citáty po neaktivite sú vypnuté.'):'Načítavam tvoje nastavenie…'}</p></div><div class="card-actions"><button class="btn primary" data-action="navigate" data-view="quotes">${A().icon('book')} Moje citáty (${saved.size})</button><button class="btn secondary" data-action="quote-settings" ${!ready?'disabled':''}>Nastavenie citátov</button><button class="btn secondary" data-action="quote-preview" ${!ready?'disabled':''}>Ukázať citát</button></div>${error?`<p class="form-error" role="alert">${esc(error)}</p><button class="btn secondary small" data-action="quote-retry">Skúsiť znova</button>`:''}</section>`;
  }
  function card(q) {
    return `<article class="quote-card"><button class="quote-card-open" data-action="quote-open" data-id="${q.id}" aria-label="Otvoriť citát: ${esc(q.text.slice(0,100))}"><span class="quote-mark" aria-hidden="true">“</span><blockquote>${esc(q.text)}</blockquote><span class="quote-author">${esc(q.author)}</span><span class="quote-verification ${q.verification==='verified'?'is-verified':''}">${verification(q)}</span></button>${sourceMarkup(q)}<button class="btn ${saved.has(q.id)?'secondary':'primary'} small" data-action="${saved.has(q.id)?'quote-remove':'quote-save'}" data-id="${q.id}" ${!ready||busy?'disabled':''}>${saved.has(q.id)?'Odobrať zo zbierky':'Uložiť do mojej zbierky'}</button></article>`;
  }
  function quoteCount(n){return n+' '+(n===1?'citát':n>=2&&n<=4?'citáty':'citátov');}
  function gallery(){return `<section class="quote-author-gallery" aria-label="Citáty podľa autorov"><div class="quote-author-gallery-heading"><h2>Galéria mysliteľov</h2><button type="button" class="btn secondary small" data-action="quote-author" data-author="">Všetci autori</button></div><div class="quote-bust-grid">${Authors.authors.map(a=>`<button type="button" class="quote-bust-card ${authorFilter===a.id?'selected':''}" data-action="quote-author" data-author="${a.id}" aria-pressed="${authorFilter===a.id}"><span class="quote-bust">${Authors.bust(a.id)}</span><strong>${esc(a.name)}</strong><small>${esc(a.theme)}</small><span>${quoteCount(catalog.filter(q=>Authors.of(q)===a.id).length)}</span></button>`).join('')}</div><p class="form-hint">Vyber bustu a otvor myšlienky autora. Galériu môžeš posúvať do strán. Neisté autorstvo je označené v detaile.</p></section>`;}
  function render() {
    sync();const list=catalog.filter(q=>(filter==='all'||saved.has(q.id))&&(!authorFilter||Authors.of(q)===authorFilter));
    return `<section class="page quotes-page"><header class="page-header"><div><p class="eyebrow">TVOJA VNÚTORNÁ KNIŽNICA</p><h1 class="page-title">Citáty</h1><p class="page-subtitle">Myšlienky, ku ktorým sa chceš vrátiť.</p></div><button class="btn secondary" data-action="quote-settings" ${!ready?'disabled':''}>Nastavenie citátov</button></header>${gallery()}<div class="quote-tabs"><button class="btn ${filter==='saved'?'primary':'secondary'}" data-action="quote-filter" data-filter="saved">Moja zbierka · ${saved.size}</button><button class="btn ${filter==='all'?'primary':'secondary'}" data-action="quote-filter" data-filter="all">Všetky citáty · ${catalog.length}</button></div>${error?`<div class="notice" role="alert">${esc(error)} <button class="btn secondary small" data-action="quote-retry">Skúsiť znova</button></div>`:''}${!ready&&!error?'<p class="muted" role="status">Načítavam tvoju zbierku…</p>':list.length?`<div class="quote-grid">${list.map(card).join('')}</div>`:'<div class="empty-state"><h2>Tvoja zbierka sa začína jednou myšlienkou.</h2><p>Otvor všetky citáty a ulož si tie, ktoré ťa oslovia.</p><button class="btn primary" data-action="quote-filter" data-filter="all">Preskúmať citáty</button></div>'}</section>`;
  }
  function open(q, idle=false) {
    if(!q||!ready)return;lastQuote=q.id;activity();
    A().openModal(idle?'Chvíľa pre jednu myšlienku':'Citát z tvojej zbierky',`<div class="quote-detail"><span class="quote-verification ${q.verification==='verified'?'is-verified':''}">${verification(q)}</span><blockquote>${esc(q.text)}</blockquote><p class="quote-author">— ${esc(q.author)}</p>${sourceMarkup(q,true)}<p class="form-hint">${esc(q.sourceNote||'')}</p><div class="card-actions"><button type="button" class="btn primary" data-action="quote-save" data-id="${q.id}" ${saved.has(q.id)?'disabled':''}>${saved.has(q.id)?'Uložené v mojej zbierke':'Uložiť do mojej zbierky'}</button><button type="button" class="btn secondary" data-close-modal>Pokračovať</button>${idle?'<button type="button" class="btn ghost" data-action="quote-disable">Vypnúť citáty po neaktivite</button>':''}</div></div>`,null,{readOnly:true});
  }
  function choose() {
    const options=catalog.filter(q=>q.id!==lastQuote);
    return options[Math.floor(Math.random()*options.length)];
  }
  function tick() {
    if(!ready||!settings.enabled||currentView!=='profile'||document.hidden||!auth().isAuthenticated()||document.querySelector('#modal')?.open)return;
    if(Date.now()-lastActivity>=settings.idleMinutes*60000)open(choose(),true);
  }
  function afterRender(view) {
    if(!sync())return;
    if(currentView!==view){currentView=view;activity();}
    if(!timer)timer=setInterval(tick,10000);
    if(view==='profile'||view==='quotes')load();
  }
  async function handleAction(action,el) {
    if(!action.startsWith('quote-'))return false;
    if(!sync())return true;
    const q=catalog.find(q=>q.id===el.dataset.id);
    if(action==='quote-author'){authorFilter=Authors.authors.some(a=>a.id===el.dataset.author)?el.dataset.author:'';filter='all';A().render();return true;}
    if(action==='quote-filter'){filter=el.dataset.filter==='all'?'all':'saved';authorFilter='';A().render();return true;}
    if(action==='quote-retry'){attempted=false;error='';load();return true;}
    if(action==='quote-open'){open(q);return true;}
    if(action==='quote-preview'){open(choose());return true;}
    if(action==='quote-settings'){
      if(!ready)return true;
      A().openModal('Citáty po neaktivite',`<p>Citát sa zobrazí iba na otvorenom profile. Počas práce v iných budovách ťa nebude vyrušovať.</p><label class="checkbox-label"><input type="checkbox" name="enabled" ${settings.enabled?'checked':''}> Zobrazovať citáty po neaktivite</label><div class="field"><label for="quote-idle">Po akom čase?</label><select id="quote-idle" name="idleMinutes">${[1,5,10,15].map(n=>`<option value="${n}" ${settings.idleMinutes===n?'selected':''}>${n} min.</option>`).join('')}</select></div>`,async fd=>{settings=await request('/api/quotes/settings',{method:'PUT',body:{enabled:fd.has('enabled'),idleMinutes:Number(fd.get('idleMinutes'))}});activity();A().render();A().toast('Nastavenie citátov je uložené.');});return true;
    }
    if(action==='quote-disable'){settings=await request('/api/quotes/settings',{method:'PUT',body:{enabled:false,idleMinutes:settings.idleMinutes}});document.querySelector('#modal')?.close();A().render();A().toast('Citáty po neaktivite sú vypnuté.');return true;}
    if(['quote-save','quote-remove'].includes(action)&&q&&ready&&!busy){
      busy=true;el.disabled=true;
      try {await request('/api/quotes/saved',{method:action==='quote-save'?'POST':'DELETE',body:{quoteId:q.id}});if(action==='quote-save')saved.add(q.id);else saved.delete(q.id);window.MOShowcase?.invalidate();A().render();if(document.querySelector('#modal')?.open&&action==='quote-save')open(q);A().toast(action==='quote-save'?'Citát je v tvojej zbierke.':'Citát bol odobratý zo zbierky.');}
      finally{busy=false;if(accountId)A().render();el.disabled=false;}
    }
    return true;
  }
  ['pointerdown','pointermove','keydown','input','scroll','touchstart'].forEach(type=>window.addEventListener(type,activity,{passive:true,capture:true}));
  document.addEventListener('visibilitychange',activity);
  document.addEventListener('close',activity,true);
  window.MOQuotes={render,controls,afterRender,handleAction,destroy};
})();
