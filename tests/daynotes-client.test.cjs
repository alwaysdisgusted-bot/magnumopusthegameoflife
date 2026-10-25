const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const decode=value=>value.replaceAll('&quot;','"').replaceAll('&gt;','>').replaceAll('&lt;','<').replaceAll('&amp;','&');
const note=(id,extra={})=>({id,date:'2026-10-19',title:'Poznámka '+id,text:'Text '+id,pins:['calendar'],revision:3,...extra});

function fixture(items=[]){
  let user={id:'A'},elements={},editor=null,showcaseInvalidations=0,handler=null;
  const calls=[],opened=[],closeListeners=[];
  const modal={open:false,addEventListener(type,fn){if(type==='close')closeListeners.push(fn);},close(){this.open=false;if(editor)editor.isConnected=false;closeListeners.splice(0).forEach(fn=>fn());}};
  const attrs=html=>Object.fromEntries([...html.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],decode(m[2])]));
  function installForm(html){
    if(editor)editor.isConnected=false;
    elements={};const controls=[];
    for(const match of html.matchAll(/<(input|textarea|select)\b([^>]*)(?:>([\s\S]*?)<\/\1>)?/g)){
      const a=attrs(match[2]),options=[...(match[3]||'').matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)];
      const value=match[1]==='textarea'?decode(match[3]||''):match[1]==='select'?(options.find(m=>/\bselected\b/.test(m[1]))||options[0])?.[1].match(/value="([^"]*)"/)?.[1]||'':a.value||'on';
      const control={...a,value,checked:/\bchecked\b/.test(match[2]),disabled:/\bdisabled\b/.test(match[2])};
      controls.push(control);if(a.id)elements[a.id]=control;
    }
    const listeners={};editor={isConnected:true,addEventListener(type,fn){listeners[type]=fn;},querySelectorAll(selector){return selector.startsWith('[name="pins"]')?controls.filter(el=>el.name==='pins'&&(!selector.includes(':checked')||el.checked)):controls;},dispatch(type,target){listeners[type]?.({target});}};
    elements['daynote-editor']=editor;
  }
  const document={getElementById:id=>id==='modal'?modal:elements[id]||null};
  const window={addEventListener(){},MOCalendar:{getSelectedDay:()=> '2026-10-19'},MOShowcase:{invalidate(){showcaseInvalidations++;}},
    MOApp:{esc:escape,model:{dateKey:()=> '2026-10-19'},render(){},navigate(){},toast(){},openModal(title,html,submit){if(modal.open)modal.close();opened.push({title,html,submit});if(html.includes('daynote-editor'))installForm(html);modal.open=true;}},
    MOAuth:{getAccount:()=>user,isAuthenticated:()=>!!user,async api(route,options){calls.push({route,options});if(handler)return handler(route,options);if(options)return{note:items[0]};if(route.includes('?'))return{notes:items};return{note:items.find(n=>route.endsWith('/'+n.id))};}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/daynotes.js'),'utf8'),{window,document,structuredClone,Map,Date});
  return{module:window.MODayNotes,calls,opened,modal,el:id=>elements[id],last:()=>opened.at(-1),get invalidations(){return showcaseInvalidations;},setUser(id){user=id?{id}:null;},setHandler(fn){handler=fn;},filter(value){const el=elements['dn-visibility-filter']={value};window.MODayNotes.afterRender('notes');el.onchange({target:el});},change(id,value){const el=elements[id];if(typeof value==='boolean')el.checked=value;else el.value=value;editor.dispatch('change',el);},submit(overrides={}){const fields={date:elements['dn-note-date']?.value,title:elements['dn-title']?.value,text:elements['dn-text']?.value,visibility:elements['dn-visibility']?.value,featured:elements['dn-featured']?.checked&&!elements['dn-featured']?.disabled?'true':null,...overrides};return opened.at(-1).submit({get:key=>fields[key]??null,getAll:()=>[...(editor?.querySelectorAll('[name="pins"]:checked')||[])].map(el=>el.value)});}};
}

test('old and new notes start private and publication controls preserve drafts safely',async()=>{
  const f=fixture([note('old')]);
  await f.module.handleAction('dn-edit',{dataset:{id:'old'}});
  assert.equal(f.el('dn-visibility').value,'private');assert.equal(f.el('dn-featured').disabled,true);assert.equal(f.el('dn-featured').checked,false);
  assert.match(f.last().html,/najviac 6 verejných poznámok/);assert.match(f.last().html,/nemení viditeľnosť poznámky/);
  f.change('dn-visibility','public');f.change('dn-featured',true);f.modal.close();
  await f.module.handleAction('dn-resume',{dataset:{}});
  assert.equal(f.el('dn-visibility').value,'public');assert.equal(f.el('dn-featured').checked,true);
  f.change('dn-visibility','private');assert.equal(f.el('dn-featured').checked,false);assert.equal(f.el('dn-featured').disabled,true);
  await f.submit({featured:'true'});
  const saved=f.calls.find(c=>c.options?.method==='PUT').options.body;
  assert.equal(saved.visibility,'private');assert.equal(saved.featured,false);assert.equal(saved.expectedRevision,3);assert.equal(f.invalidations,1);
  f.modal.close();await f.module.handleAction('dn-new',{dataset:{section:'calendar'}});
  assert.equal(f.el('dn-visibility').value,'private');assert.equal(f.el('dn-featured').checked,false);assert.equal(f.el('dn-featured').disabled,true);
});

test('public exhibit is sent explicitly and a rejected save retains its draft',async()=>{
  const f=fixture();await f.module.handleAction('dn-new',{dataset:{section:'calendar'}});
  f.change('dn-text','Verejná myšlienka');f.change('dn-visibility','public');f.change('dn-featured',true);
  f.setHandler(async()=>{throw Error('Na profile už máš 6 poznámok.');});
  await assert.rejects(f.submit(),/6 poznámok/);
  assert.equal(f.el('dn-visibility').disabled,false);assert.equal(f.el('dn-featured').disabled,false);assert.equal(f.el('dn-featured').checked,true);assert.equal(f.module.hasUnsavedDrafts(),true);assert.equal(f.invalidations,0);
  f.setHandler(async()=>({note:note('new')}));await f.submit();
  const saved=f.calls.filter(c=>c.options?.method==='POST').at(-1).options.body;
  assert.equal(saved.visibility,'public');assert.equal(saved.featured,true);assert.equal(f.invalidations,1);assert.equal(f.module.hasUnsavedDrafts(),false);
});

test('owned note filters and details show privacy without exposing unescaped contents',async()=>{
  const f=fixture([note('old',{title:'<script>old</script>',text:'<img src=x onerror=alert(1)>'}),note('public',{visibility:'public',featured:true})]);
  f.module.render();f.module.afterRender('notes');await flush();
  let html=f.module.render();assert.match(html,/is-private/);assert.match(html,/is-public/);assert.match(html,/Vystavená na profile/);assert.match(html,/&lt;script&gt;old&lt;\/script&gt;/);assert.doesNotMatch(html,/<img src=x/);
  f.filter('public');html=f.module.render();assert.match(html,/data-id="public"/);assert.doesNotMatch(html,/data-id="old"/);
  f.filter('private');html=f.module.render();assert.match(html,/data-id="old"/);assert.doesNotMatch(html,/data-id="public"/);
  f.filter('all');assert.match(f.module.render(),/data-id="public"/);
  await f.module.handleAction('dn-open',{dataset:{id:'old'}});assert.match(f.last().html,/is-private/);assert.doesNotMatch(f.last().html,/Vystavená na profile/);assert.match(f.last().html,/&lt;img src=x/);
  f.modal.close();await f.module.handleAction('dn-open',{dataset:{id:'public'}});assert.match(f.last().html,/is-public/);assert.match(f.last().html,/Vystavená na profile/);
});

test('account switches isolate publication drafts and reject stale editor submissions',async()=>{
  const f=fixture();await f.module.handleAction('dn-new',{dataset:{section:'calendar'}});
  f.change('dn-title','Draft A');f.change('dn-visibility','public');f.change('dn-featured',true);const staleSubmit=f.submit.bind(f);
  f.setUser('B');f.module.render();assert.equal(f.module.hasUnsavedDrafts(),false);await assert.rejects(staleSubmit(),/Otvor poznámku znova/);assert.equal(f.calls.length,0);
  f.modal.close();await f.module.handleAction('dn-new',{dataset:{section:'calendar'}});assert.equal(f.el('dn-visibility').value,'private');assert.equal(f.el('dn-featured').checked,false);
  f.modal.close();f.setUser('A');f.module.render();await f.module.handleAction('dn-resume',{dataset:{}});
  assert.equal(f.el('dn-title').value,'Draft A');assert.equal(f.el('dn-visibility').value,'public');assert.equal(f.el('dn-featured').checked,true);
});

test('successful deletion invalidates profile notes and a stale response cannot clear a new account draft',async()=>{
  const f=fixture([note('public',{visibility:'public',featured:true})]);
  await f.module.handleAction('dn-delete',{dataset:{id:'public',revision:'3'}});await f.last().submit();assert.equal(f.invalidations,1);
  f.modal.close();await f.module.handleAction('dn-new',{dataset:{section:'calendar'}});f.change('dn-text','Account A');
  let finish;f.setHandler(()=>new Promise(resolve=>{finish=resolve;}));const pending=f.submit();
  f.setUser('B');f.module.render();f.modal.close();await f.module.handleAction('dn-new',{dataset:{section:'calendar'}});f.change('dn-text','Account B');
  finish({note:note('saved')});await assert.rejects(pending,/Prihlásenie sa zmenilo/);assert.equal(f.invalidations,1);assert.equal(f.el('dn-text').value,'Account B');assert.equal(f.module.hasUnsavedDrafts(),true);
});

test('global owned view lists public notes across dates and sections and resets its cache after mutations and account changes',async()=>{
  const f=fixture();
  const owned=[note('distant-public',{date:'2020-01-01',pins:['library'],visibility:'public'}),note('unattached-private',{date:'2022-12-12',pins:[]})];
  f.setHandler(async(route,options)=>options?{}:{notes:owned});
  f.module.openPublic();f.module.afterRender('notes');await flush();
  assert.equal(f.calls[0].route,'/api/calendar/notes?all=1');
  let html=f.module.render();assert.match(html,/Všetky tvoje poznámky/);assert.match(html,/Všetky moje poznámky/);assert.match(html,/data-id="distant-public"/);assert.doesNotMatch(html,/data-id="unattached-private"/);
  f.filter('private');html=f.module.render();assert.match(html,/data-id="unattached-private"/);assert.doesNotMatch(html,/data-id="distant-public"/);
  f.filter('all');html=f.module.render();assert.match(html,/data-id="unattached-private"/);assert.match(html,/data-id="distant-public"/);
  await f.module.handleAction('dn-delete',{dataset:{id:'distant-public',revision:'3'}});await f.last().submit();
  f.module.afterRender('notes');await flush();assert.equal(f.calls.filter(c=>c.route==='/api/calendar/notes?all=1').length,2);
  f.setUser('B');f.setHandler(async()=>({notes:[note('other-owner',{visibility:'public'})]}));f.module.openPublic();
  assert.doesNotMatch(f.module.render(),/data-id="distant-public"/);
  f.module.afterRender('notes');await flush();html=f.module.render();assert.match(html,/data-id="other-owner"/);assert.doesNotMatch(html,/data-id="unattached-private"/);
  await f.module.handleAction('dn-mode-day',{dataset:{}});await f.module.handleAction('dn-mode-all',{dataset:{}});assert.match(f.module.render(),/Všetky tvoje poznámky/);
});
