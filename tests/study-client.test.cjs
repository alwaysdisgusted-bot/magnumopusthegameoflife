'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const M = require('../server/study-model.mjs').default;
const source = fs.readFileSync(path.join(__dirname, '../public/study.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const decode = value => String(value).replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
function fixture(handler, photoHandler) {
  let account = { id: 'A' }, modal = null, nodes = new Map(); const requests = [], notifications = [], events = {};
  const element = () => ({ value:'', innerHTML:'', disabled:false, isConnected:true, files:[], listeners:{},
    addEventListener(name,fn,options){(this.listeners[name]||= []).push({fn,once:options?.once});},
    async dispatch(name,event={}){for(const entry of [...(this.listeners[name]||[])]){if(entry.once)this.listeners[name]=this.listeners[name].filter(value=>value!==entry);await entry.fn({target:this,...event});}},
    querySelectorAll(){return [...nodes.entries()].filter(([id])=>['study-title','study-text','study-categoryId','study-photo','study-ocr','study-photo-remove'].includes(id)).map(([,node])=>node);},
    removeAttribute(name){delete this[name];}
  });
  const dialog = element();
  const state = { books:[], bank:{card:0,cash:0,invested:0,owed:0,receivable:0},strategies:[] };
  const app = { state, esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),render(){},toast(value){notifications.push(value);},
    openModal(title,html,submit,options){
      for(const node of nodes.values())node.isConnected=false;
      nodes=new Map();for(const match of html.matchAll(/\bid="([^"]+)"/g))nodes.set(match[1],element());
      for(const match of html.matchAll(/<input[^>]*\bid="([^"]+)"[^>]*\bvalue="([^"]*)"/g))nodes.get(match[1]).value=decode(match[2]);
      const text=/<textarea[^>]*id="study-text"[^>]*>([\s\S]*?)<\/textarea>/.exec(html);if(text)nodes.get('study-text').value=decode(text[1]);
      const select=/<select[^>]*id="study-categoryId"[^>]*>([\s\S]*?)<\/select>/.exec(html);if(select){const option=/<option value="([^"]+)"[^>]*selected/.exec(select[1])||/<option value="([^"]+)"/.exec(select[1]);nodes.get('study-categoryId').value=option?.[1]||'';}
      modal={title,html,submit,options};
    }
  };
  const window = { MOApp:app, MOStudyModel:{createState:M.createState,validateState:value=>M.validateState(clone(value))},
    MOAuth:{getAccount:()=>account,isAuthenticated:()=>!!account,api:async(url,options={})=>{const request={url,account:account?.id,...options};requests.push(request);return handler(request);}},
    MOPhotoOCR:{cancel(){},resize:file=>photoHandler?photoHandler(file):Promise.resolve('data:image/png;base64,YQ=='),recognize:()=>Promise.resolve('Prepis')},addEventListener(name,fn){events[name]=fn;}
  };
  vm.runInNewContext(source,{window,document:{getElementById:id=>id==='modal'?dialog:nodes.get(id)||null},crypto:webcrypto,structuredClone,Blob,URL,Intl,console,setTimeout,clearTimeout});
  return { study:window.MOStudy, requests,notifications,state,events, node:id=>nodes.get(id), modal:()=>modal,
    account:value=>{account=value;}, close:()=>dialog.dispatch('close'),
    fd:()=>({get:key=>({'title':nodes.get('study-title')?.value,'text':nodes.get('study-text')?.value,'categoryId':nodes.get('study-categoryId')?.value}[key]),getAll:()=>[]}) };
}
const action=(f,name,id)=>f.study.handleAction(name,{dataset:{id}});
const defaults=request=>request.url==='/api/study'?{state:M.createState(),revision:0}: {pages:[]};

test('another note cannot replace a held draft and reopening the same note resumes its text',async()=>{
  const f=fixture(defaults);f.study.afterRender('study');await settle();
  await action(f,'study-note');f.node('study-text').value='Rozpísaný dôležitý text';await f.node('study-editor').dispatch('input');await f.close();
  assert.equal(f.study.hasUnsavedDrafts(),true);await assert.rejects(action(f,'study-note'),/rozpísanú/);
  await action(f,'study-resume');assert.equal(f.node('study-text').value,'Rozpísaný dôležitý text');
});

test('note saves lock their editor and a conflict preserves the draft for explicit retry',async()=>{
  const pending=deferred();
  const f=fixture(request=>request.method==='PUT'?pending.promise:defaults(request));f.study.afterRender('study');await settle();
  await action(f,'study-note');f.node('study-title').value='Názov';f.node('study-text').value='Zachovať pri konflikte';await f.node('study-editor').dispatch('input');
  const save=f.modal().submit(f.fd());assert.equal(f.node('study-text').disabled,true);await assert.rejects(action(f,'study-note'),/Počkaj/);
  pending.resolve(Promise.reject(Object.assign(new Error('Štúdium sa zmenilo v inom okne.'),{status:409})));
  await assert.rejects(save,/inom okne/);assert.equal(f.node('study-text').disabled,false);assert.equal(f.study.hasUnsavedDrafts(),true);
  await f.close();await action(f,'study-resume');assert.equal(f.node('study-text').value,'Zachovať pri konflikte');assert.match(f.study.render(),/Rozpísaný text zostáva/);
  assert.equal(f.requests.filter(r=>r.method==='PUT').length,1);
});

test('late photo preparation cannot replace a newer selected photograph',async()=>{
  const left=deferred(),right=deferred();
  const f=fixture(request=>request.method==='PUT'?{revision:1}:defaults(request),file=>file.name==='left'?left.promise:right.promise);f.study.afterRender('study');await settle();await action(f,'study-note');
  const input=f.node('study-photo');input.files=[{name:'left'}];const first=input.dispatch('change');input.files=[{name:'right'}];const second=input.dispatch('change');
  assert.equal(f.study.hasUnsavedDrafts(),true);right.resolve('data:image/png;base64,Yg==');await second;left.resolve('data:image/png;base64,YQ==');await first;
  await f.modal().submit(f.fd());const saved=f.requests.find(r=>r.method==='PUT');assert.equal(saved.body.state.notes[0].photo,'data:image/png;base64,Yg==');
});

test('link edits keep unavailable page associations and their originally selected category',async()=>{
  const study=M.createState();study.categories.push({id:'other',name:'Iný predmet',parentId:null,slot:1,keywords:[]});study.links.push({id:'private-link',categoryId:'finance',kind:'page',targetId:'page-unavailable'});
  const f=fixture(request=>{if(request.method==='PUT')return {revision:2};if(request.url==='/api/study')return {state:study,revision:1};throw new Error('Stránky sú nedostupné.');});
  f.study.afterRender('study');await settle();await action(f,'study-link');const submit=f.modal().submit;await action(f,'study-select','other');
  await submit({getAll:()=>['0']});const saved=f.requests.find(r=>r.method==='PUT').body.state;
  assert.ok(saved.links.some(l=>l.id==='private-link'&&l.categoryId==='finance'));assert.ok(saved.links.some(l=>l.kind==='finance'&&l.categoryId==='finance'));assert.equal(saved.links.some(l=>l.categoryId==='other'),false);
});

test('responses from a previous account cannot replace the next account study',async()=>{
  const pending=deferred(),own=M.createState();own.categories[0].name='Účet B';
  const f=fixture(request=>request.method==='PUT'?pending.promise:request.url==='/api/study'?{state:request.account==='B'?own:M.createState(),revision:0}:{pages:[]});
  f.study.afterRender('study');await settle();await action(f,'study-note');f.node('study-text').value='Účet A – súkromný text';await f.node('study-editor').dispatch('input');const saving=f.modal().submit(f.fd());
  f.study.destroy({preserveDraft:true});f.account({id:'B'});f.study.afterRender('study');await settle();pending.resolve({revision:1});await assert.rejects(saving,/Prihlásenie sa zmenilo/);
  const html=f.study.render();assert.match(html,/Účet B/);assert.equal(html.includes('Účet A'),false);assert.equal(f.notifications.length,0);
});
