const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}){
  let user={id:'A'},now=0,tick,opened=[],prefs={enabled:true,idleMinutes:5},modal={open:false,close(){this.open=false;}},listeners={};
  const calls=[];
  const document={hidden:false,querySelector:()=>modal,addEventListener:(type,fn)=>listeners[type]=fn};
  const window={MOQuoteCatalog:options.catalog||[{id:'text-1',text:'<script>myšlienka</script>',author:'Autor'}],MOQuoteSources:options.sources,addEventListener:(type,fn)=>listeners[type]=fn,
    MOApp:{state:{books:options.books||[]},esc:v=>String(v).replaceAll('<','&lt;').replaceAll('>','&gt;'),icon:()=>'',render(){},toast(){},openModal(title,html,submit){opened.push({title,html,submit});modal.open=true;}},
    MOAuth:{getAccount:()=>user,isAuthenticated:()=>!!user,async api(route,options){calls.push({route,options});if(route.endsWith('/settings')){if(options)prefs=options.body;return prefs;}return{saved:[]};}}};
  class Clock extends Date{static now(){return now;}}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/quotes.js'),'utf8'),{window,document,Date:Clock,setInterval:fn=>(tick=fn,1),clearInterval(){},Set,Math});
  return{module:window.MOQuotes,document,modal,opened,calls,advance(ms){now+=ms;tick();},setUser(id){user=id?{id}:null;},listeners,getPrefs:()=>prefs};
}
test('idle quotes appear only after the configured time on a visible profile without an open form',async()=>{
  const f=fixture();f.module.afterRender('profile');await flush();
  f.advance(299999);assert.equal(f.opened.length,0);f.advance(1);assert.equal(f.opened.length,1);assert.match(f.opened[0].html,/&lt;script&gt;/);
  f.advance(300000);assert.equal(f.opened.length,1);f.modal.open=false;f.document.hidden=true;f.advance(300000);assert.equal(f.opened.length,1);
  f.document.hidden=false;f.module.afterRender('gym');f.advance(300000);assert.equal(f.opened.length,1);
});

test('old screenshot quote IDs render plain text in cards, details and idle previews, with book links only in private details',async()=>{
  const book={id:'book-1',title:'Hovory k sebe',author:'Marcus Aurelius'},sourceCalls=[];
  const f=fixture({catalog:[{id:'scan-14',text:'A transcribed thought',author:'Mark Fisher',image:'assets/quotes/14.png',verification:'verified'}],books:[book],sources:{workMarkup(q,options){sourceCalls.push(options);return '<p class="quote-work">Capitalist Realism</p>';}}});
  f.module.afterRender('quotes');await flush();
  await f.module.handleAction('quote-filter',{dataset:{filter:'all'}});
  const cards=f.module.render();assert.match(cards,/A transcribed thought/);assert.match(cards,/Autor a dielo overené/);assert.match(cards,/Capitalist Realism/);assert.doesNotMatch(cards,/<img|assets\/quotes|<svg/);
  assert.ok(sourceCalls.every(options=>options.linkBooks===false&&options.books.length===0));
  await f.module.handleAction('quote-open',{dataset:{id:'scan-14'}});
  assert.doesNotMatch(f.opened.at(-1).html,/<img|assets\/quotes|<svg/);assert.equal(sourceCalls.at(-1).linkBooks,true);assert.equal(sourceCalls.at(-1).books[0],book);
  f.modal.close();f.module.destroy();f.module.afterRender('profile');await flush();f.advance(300000);
  assert.doesNotMatch(f.opened.at(-1).html,/<img|assets\/quotes|<svg/);assert.match(f.opened.at(-1).html,/A transcribed thought/);
});
test('disabling idle quotes persists and account switches clear the visible saved collection',async()=>{
  const f=fixture();f.module.afterRender('profile');await flush();
  await f.module.handleAction('quote-save',{dataset:{id:'text-1'}});assert.match(f.module.render(),/Moja zbierka · 1/);
  await f.module.handleAction('quote-disable',{dataset:{}});assert.equal(f.getPrefs().enabled,false);f.advance(600000);assert.equal(f.opened.length,0);
  f.setUser('B');assert.match(f.module.controls(),/Moje citáty \(0\)/);f.module.destroy();
});
