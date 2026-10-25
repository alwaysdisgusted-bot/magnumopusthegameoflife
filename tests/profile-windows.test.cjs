const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('portrait and replacement logo open the profile while windows remain limited to buildings', () => {
  const timers = new Map();
  let timerId = 0, observer;
  const document = {activeElement:null, events:new Map()};
  const element = () => ({
    hidden:false, style:{}, attrs:{}, events:new Map(),
    setAttribute(name,value) { this.attrs[name]=value; },
    getAttribute(name) { return this.attrs[name]; },
    addEventListener(type,handler) { this.events.set(type,handler); },
    contains(target) { return target===this || target?.parent===this; },
    focus() { document.activeElement=this; this.events.get('focus')?.({target:this}); },
    getBoundingClientRect() { return {top:200,right:85}; }, offsetHeight:650
  });
  const avatar=element(), panel=element(), first=element(), closeButton=element(), brand=element();
  brand.setAttribute('aria-label','Magnum Opus — návrat do dedinky');
  first.parent=panel;
  const classes=new Set();
  document.body={classList:{contains:name=>classes.has(name),add:name=>classes.add(name),remove:name=>classes.delete(name)},appendChild(node){assert.equal(node,panel);}};
  document.querySelector=selector=>selector==='#avatar'?avatar:selector==='.village-crown .brand'?brand:null;
  document.createElement=()=>panel;
  document.addEventListener=(type,handler)=>document.events.set(type,handler);
  panel.querySelector=selector=>selector==='.village-window'?first:closeButton;
  const window={innerWidth:1280,innerHeight:900,location:{hash:'#gym'},events:new Map(),addEventListener(type,handler){this.events.set(type,handler);}};
  const navigations=[];
  window.MOApp={navigate:view=>navigations.push(view)};
  vm.runInNewContext(fs.readFileSync('public/profile-windows.js','utf8'),{
    document, window,
    setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);},
    MutationObserver:class{constructor(callback){observer=callback;}observe(){}}
  });
  const send=(target,type,event={})=>target.events.get(type)?.(event);
  const flush=()=>{for(const [id,fn] of timers){timers.delete(id);fn();}};
  assert.equal(panel.hidden,true);
  assert.equal((panel.innerHTML.match(/class="village-window"/g)||[]).length,10);
  assert.equal(new Set([...panel.innerHTML.matchAll(/clipPath id="([^"]+)"/g)].map(m=>m[1])).size,10);
  assert.ok(panel.innerHTML.includes('data-view="profile"'));
  send(avatar,'pointerenter',{pointerType:'mouse'});
  assert.equal(panel.hidden,false);
  assert.ok(classes.has('profile-windows-open'),'open swaps the brand and portrait');
  assert.ok(classes.has('profile-trigger-hovered'),'pointer entry keeps the portrait hidden independently of the panel');
  assert.equal(panel.style.top,'12px','desktop dock moves to the top edge');
  assert.equal(avatar.attrs['aria-expanded'],'true');
  send(avatar,'pointerleave');
  send(panel,'pointerenter');
  flush();
  assert.equal(panel.hidden,false,'crossing into the panel cancels delayed close');
  send(panel,'pointerleave');flush();
  assert.equal(panel.hidden,true);
  assert.ok(!classes.has('profile-windows-open'),'close restores the centered brand and portrait');
  assert.ok(!classes.has('profile-trigger-hovered'),'leaving the trigger restores portrait visibility');
  send(avatar,'pointerenter',{pointerType:'mouse'});
  send(avatar,'pointerleave');
  send(brand,'pointerenter');flush();
  assert.equal(panel.hidden,false,'moving onto the replacement brand keeps windows open');
  send(document,'pointerdown',{target:brand});
  assert.equal(panel.hidden,false,'brand remains a clickable navigation link');
  let prevented=false,stopped=false;
  send(brand,'click',{preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});
  assert.ok(prevented&&stopped,'replacement logo must not bubble or follow its old village destination');
  assert.equal(navigations.at(-1),'profile');
  assert.equal(panel.hidden,true,'brand click closes and restores the portrait');
  assert.ok(classes.has('profile-trigger-hovered'),'closing while hovering must keep the portrait hidden');
  assert.equal(brand.attrs.href,'#village','centered title regains its village destination');
  assert.equal(brand.attrs['aria-label'],'Magnum Opus — návrat do dedinky');
  send(avatar,'pointerenter',{pointerType:'mouse'});
  assert.equal(panel.hidden,true,'revealing the portrait beneath a stationary pointer must not reopen');
  assert.ok(classes.has('profile-trigger-hovered'),'a stationary pointer never reveals the portrait after close');
  send(avatar,'pointerleave',{relatedTarget:element()});
  assert.ok(!classes.has('profile-trigger-hovered'),'portrait returns only after pointer departure');
  send(avatar,'pointerenter',{pointerType:'mouse'});
  assert.equal(panel.hidden,false,'a fresh entry after leaving the trigger opens normally');
  send(brand,'click',{preventDefault(){},stopPropagation(){}});
  send(brand,'pointerleave',{relatedTarget:element()});
  send(avatar,'pointerenter',{pointerType:'touch'});
  assert.equal(panel.hidden,true,'touch pointer entry alone must not open');
  assert.ok(!classes.has('profile-trigger-hovered'),'touch must not leave a hidden portrait');
  const beforeTouch=navigations.length;
  send(avatar,'click');
  assert.equal(navigations.length,beforeTouch+1);
  assert.equal(navigations.at(-1),'profile','touch activation directly opens own profile');
  assert.equal(panel.hidden,true,'profile activation closes the windows');
  send(avatar,'keydown',{key:'ArrowDown',preventDefault(){}});
  prevented=false;
  send(document,'keydown',{key:'Escape',preventDefault(){prevented=true;},stopImmediatePropagation(){}});
  assert.ok(prevented);
  assert.equal(panel.hidden,true,'Escape focus restoration must not reopen');
  assert.equal(document.activeElement,avatar);
  send(avatar,'keydown',{key:'ArrowDown',preventDefault(){}});
  assert.equal(document.activeElement,first);
  assert.equal(panel.hidden,false);
  send(avatar,'keydown',{key:'Tab',shiftKey:false,preventDefault(){}});
  assert.equal(document.activeElement,first,'Tab from open trigger enters windows');
  document.activeElement=null;
  send(document,'pointerdown',{target:element()});
  assert.equal(panel.hidden,true);
  send(avatar,'keydown',{key:'ArrowDown',preventDefault(){}});
  window.innerWidth=390;
  send(window,'resize');
  assert.equal(panel.hidden,true,'mobile sidebar must be open to expose the panel');
  window.innerWidth=1280;
  send(avatar,'keydown',{key:'ArrowDown',preventDefault(){}});
  for (const view of ['village','meditation']) {
    window.MOProfileWindows.afterRender(view);
    assert.equal(panel.hidden,true,'leaving a building closes the windows');
    assert.ok(!classes.has('profile-windows-open'));
    assert.notEqual(avatar.attrs['aria-disabled'],'true','profile button must remain enabled outdoors');
    send(avatar,'pointerleave',{relatedTarget:element()});
    send(avatar,'pointerenter',{pointerType:'mouse'});
    avatar.focus();
    send(avatar,'keydown',{key:'ArrowDown',preventDefault(){}});
    assert.equal(panel.hidden,true,view+' must reject window opening');
    assert.equal(document.activeElement,avatar,'blocked keyboard input cannot focus hidden windows');
    const beforeClick=navigations.length;
    send(avatar,'click');
    assert.equal(navigations.length,beforeClick+1);
    assert.equal(navigations.at(-1),'profile',view+' portrait still directly opens the profile');
    assert.equal(panel.hidden,true);
  }
  window.MOProfileWindows.afterRender('library');
  send(avatar,'keydown',{key:'ArrowDown',preventDefault(){}});
  assert.equal(panel.hidden,false,'a building still allows opening');
  assert.equal(brand.attrs.href,'#profile','logo occupying the portrait uses the same profile destination');
  window.location.hash='#library/grimoire';
  send(window,'hashchange');
  send(avatar,'keydown',{key:'ArrowDown',preventDefault(){}});
  assert.equal(panel.hidden,false,'nested Grimoire routes still count as being inside the library');
  window.location.hash='#meditation';
  send(window,'hashchange');
  assert.equal(panel.hidden,true,'native hash changes also close forbidden views');
  window.MOProfileWindows.afterRender('gym');
  send(avatar,'keydown',{key:'ArrowDown',preventDefault(){}});
  classes.add('auth-locked');observer();
  assert.equal(panel.hidden,true);
  send(avatar,'pointerenter',{pointerType:'mouse'});
  assert.equal(panel.hidden,true,'locked app never exposes navigation');
  const beforeLocked=navigations.length;
  send(avatar,'click');
  assert.equal(navigations.length,beforeLocked,'locked app cannot navigate through the portrait');
  classes.delete('auth-locked');
  window.MOProfileWindows.afterRender('gym');
  window.innerWidth=390;
  classes.add('menu-open');
  send(avatar,'click');
  assert.equal(navigations.at(-1),'profile','mobile portrait opens own profile');
  assert.equal(panel.hidden,true);
  const beforeCentered=navigations.length;
  send(brand,'click',{});
  assert.equal(navigations.length,beforeCentered,'closed centered title retains normal link behavior');
});
