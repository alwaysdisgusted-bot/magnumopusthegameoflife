(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MOGoodreads = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var MAX_BYTES = 5 * 1024 * 1024, MAX_ROWS = 10000, modalSerial = 0;
  function fail(message) { throw new Error(message); }
  function bytes(value) { return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(value).length : unescape(encodeURIComponent(value)).length; }
  function headerKey(value) { return String(value).trim().toLowerCase().replace(/[\s_-]+/g, ''); }
  function parseCSV(text) {
    if (typeof text !== 'string') fail('Vyber textový CSV export z Goodreads.');
    if (text.length > MAX_BYTES || bytes(text) > MAX_BYTES) fail('CSV súbor môže mať najviac 5 MB.');
    text = text.replace(/^\uFEFF/, '');
    var matrix = [], row = [], field = '', quoted = false, closed = false;
    function finishField() { row.push(field); field = ''; closed = false; if(row.length>100)fail('CSV obsahuje príliš veľa stĺpcov.'); }
    function finishRow() { finishField(); if(row.some(function(value){return value!=='';}))matrix.push(row);row=[];if(matrix.length>MAX_ROWS+1)fail('CSV môže obsahovať najviac 10 000 kníh.'); }
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (quoted) {
        if (c === '"') { if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;} }
        else field += c;
      } else if (c === ',') finishField();
      else if (c === '\n' || c === '\r') { if(c==='\r'&&text[i+1]==='\n')i++;finishRow(); }
      else if (c === '"') { if(field!==''||closed)fail('CSV obsahuje nesprávne uzavreté úvodzovky.');quoted=true; }
      else if (closed) { if(c!==' '&&c!=='\t')fail('Za uzavretým CSV poľom musí nasledovať čiarka alebo koniec riadka.'); }
      else field += c;
    }
    if (quoted) fail('CSV obsahuje neuzavreté úvodzovky.');
    if(field!==''||row.length||closed)finishRow();
    if(!matrix.length)fail('CSV súbor je prázdny.');
    var headers=matrix.shift().map(function(value){return value.trim();}),seen=new Set();
    headers.forEach(function(value){var key=headerKey(value);if(!key||seen.has(key))fail('CSV hlavička obsahuje prázdny alebo opakovaný názov stĺpca.');seen.add(key);});
    if(!seen.has('title'))fail('Nenašiel sa stĺpec Title. Použi oficiálny export knižnice z Goodreads.');
    var rows=matrix.map(function(values,index){if(values.length>headers.length)fail('Riadok '+(index+2)+' má viac polí než CSV hlavička.');var record=Object.create(null);headers.forEach(function(key,j){record[key]=values[j]===undefined?'':values[j];});return record;});
    return { headers: headers, rows: rows };
  }
  function normalize(value) { return String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('sk-SK'); }
  function titleKey(title,author) { return normalize(title)+'\u0000'+normalize(author); }
  function cell(record,key) { var found=Object.keys(record).find(function(header){return headerKey(header)===key;});return found===undefined?'':String(record[found]).trim(); }
  function safeText(value,max,required) { return value.length<=max&&(!required||!!value.trim())&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value); }
  function isbn(value) { value=String(value||'').trim().replace(/^="([^"]*)"$/,'$1').replace(/[\s-]/g,'');return /^(?:\d{10}|\d{13})$/.test(value)?value:''; }
  function profileURL(value) {
    value=String(value||'').trim();if(!value)return '';
    var url;try{url=new URL(value);}catch(_){fail('Vlož platný HTTPS odkaz na svoj profil Goodreads.');}
    var match=/^\/user\/show\/(\d+)(?:[^/]*)\/?$/.exec(url.pathname);
    if(url.protocol!=='https:'||!['goodreads.com','www.goodreads.com'].includes(url.hostname.toLowerCase())||url.username||url.password||url.port||!match)fail('Použi odkaz https://www.goodreads.com/user/show/… na svoj osobný profil.');
    return 'https://www.goodreads.com/user/show/'+match[1];
  }
  function planImport(input,existingBooks,options) {
    var parsed=typeof input==='string'?parseCSV(input):input;options=options||{};
    if(!parsed||!Array.isArray(parsed.rows)||parsed.rows.length>MAX_ROWS)fail('Neplatný CSV export.');
    existingBooks=Array.isArray(existingBooks)?existingBooks:[];
    var result={totalRows:parsed.rows.length,books:[],duplicates:0,missingPages:0,invalid:0,capacitySkipped:0,ignoredTags:0},ids=new Set(),titles=new Set(),capacity=Math.max(0,500-existingBooks.length);
    existingBooks.forEach(function(book){if(book.goodreads&&book.goodreads.id)ids.add(String(book.goodreads.id));titles.add(titleKey(book.title,book.author));});
    parsed.rows.forEach(function(record){
      var title=cell(record,'title'),author=cell(record,'author'),rawId=cell(record,'bookid'),id=/^\d{1,30}$/.test(rawId)?rawId:'',key=titleKey(title,author);
      if(!safeText(title,200,true)||!safeText(author,200,false)){result.invalid++;return;}
      if((id&&ids.has(id))||titles.has(key)){result.duplicates++;return;}
      var rawPages=cell(record,'numberofpages'),total=/^\d+$/.test(rawPages)?Number(rawPages):0;
      if(!Number.isSafeInteger(total)||total<1||total>100000){result.missingPages++;return;}
      var rawShelf=cell(record,'exclusiveshelf'),shelf=safeText(rawShelf,80,false)?rawShelf:'',tags=[],tagSeen=new Set();
      cell(record,'bookshelves').split(',').concat(shelf?[shelf]:[]).forEach(function(tag){tag=tag.trim();if(!tag)return;var folded=normalize(tag);if(tagSeen.has(folded))return;if(!safeText(tag,60,true)||tags.length>=30){result.ignoredTags++;return;}tagSeen.add(folded);tags.push(tag);});
      var rating=Number(cell(record,'myrating'));if(!Number.isInteger(rating)||rating<0||rating>5)rating=0;
      var book={title:title,author:author,total:total,current:options.readAsComplete&&normalize(shelf)==='read'?total:0,tags:tags,cover:'',goodreads:{id:id,isbn:isbn(cell(record,'isbn13')||cell(record,'isbn')),shelf:shelf,rating:rating}};
      if(result.books.length>=capacity){result.capacitySkipped++;return;}
      result.books.push(book);if(id)ids.add(id);titles.add(key);
    });
    result.importCount=result.books.length;return result;
  }
  function importIntoState(state,model,input,options) {
    options=options||{};var url=options.profileUrl===undefined?undefined:profileURL(options.profileUrl),plan=planImport(input,state.books,options);
    plan.books.forEach(function(book){model.addBook(state,book);});
    if(url!==undefined)state.settings.goodreadsUrl=url;
    return plan;
  }
  function app() { return window.MOApp; }
  function esc(value) { return app().esc(value); }
  function previewHTML(plan) {
    var details=[plan.importCount+' kníh pripravených na import'];
    if(plan.duplicates)details.push(plan.duplicates+' už existuje');if(plan.missingPages)details.push(plan.missingPages+' bez platného počtu strán');if(plan.invalid)details.push(plan.invalid+' neplatných záznamov');if(plan.capacitySkipped)details.push(plan.capacitySkipped+' nad limitom 500 kníh');
    return '<div class="notice" style="margin:10px 0"><strong>'+esc(details[0])+'</strong><p style="margin:5px 0 0">'+esc(details.slice(1).join(' · ')||'Nové knihy pribudnú do tvojej knižnice.')+'</p>'+(plan.missingPages?'<p class="form-hint">Knihy bez počtu strán preskočíme. Môžeš ich neskôr pridať ručne so správnym počtom strán.</p>':'')+(plan.ignoredTags?'<p class="form-hint">Niektoré tagy prekročili limit 30 tagov na knihu alebo 60 znakov na tag.</p>':'')+'</div>'+(plan.books.length?'<div style="max-height:260px;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr><th style="text-align:left;padding:8px">Kniha</th><th style="text-align:left;padding:8px">Autor</th><th style="text-align:right;padding:8px">Strany</th></tr></thead><tbody>'+plan.books.slice(0,20).map(function(book){return '<tr style="border-top:1px solid #d9ae542b"><td style="padding:8px">'+esc(book.title)+(book.current?'<small style="display:block;color:#a1ccb1">Dočítaná · bez odmeny</small>':'')+'</td><td style="padding:8px">'+esc(book.author||'Neuvedený')+'</td><td style="padding:8px;text-align:right">'+book.total+'</td></tr>';}).join('')+'</tbody></table></div>'+(plan.books.length>20?'<p class="form-hint">Náhľad prvých 20 z '+plan.books.length+' pripravených kníh.</p>':''):'');
  }
  function open() {
    var serial=++modalSerial,parsed=null,reading=false,fileError='',readAsComplete=false,initialAccount=window.MOAuth?.getAccount?.()?.id||'';
    var initialUrl=app().state.settings.goodreadsUrl||'';
    app().openModal('Goodreads · import knižnice','<p>Prenes knihy z oficiálneho CSV exportu. Prihlásenie do Goodreads prebieha iba na ich stránke.</p><p><a href="https://www.goodreads.com/review/import" target="_blank" rel="noopener noreferrer">Otvoriť export knižnice na Goodreads ↗</a></p><div class="field"><label for="goodreads-profile">Odkaz na tvoj profil (voliteľné)</label><input type="url" id="goodreads-profile" name="goodreadsUrl" value="'+esc(initialUrl)+'" placeholder="https://www.goodreads.com/user/show/…" maxlength="1000"></div><div class="field"><label for="goodreads-file">CSV export knižnice</label><input type="file" id="goodreads-file" accept=".csv,text/csv" aria-describedby="goodreads-file-hint"><span id="goodreads-file-hint" class="form-hint">Najviac 5 MB a 10 000 riadkov. Pred potvrdením uvidíš náhľad.</span></div><label class="checkbox-label"><input type="checkbox" name="goodreadsRead" id="goodreads-read"> Knihy z poličky „read“ označiť ako dočítané</label><p class="form-hint">Import nepridáva koruny. Existujúce knihy a ich progres zostávajú zachované. Poličky sa prenesú ako tagy.</p><div id="goodreads-preview" aria-live="polite"><p class="muted">Vyber CSV súbor pre náhľad importu.</p></div>',async function(fd){
      if(window.MOAuth?.getAccount?.()?.id!==initialAccount)fail('Prihlásenie sa zmenilo. Otvor import znova.');
      if(reading)fail('CSV sa ešte načítava. Chvíľku počkaj.');if(fileError)fail(fileError);
      var url=profileURL(String(fd.get('goodreadsUrl')||''));if(!parsed&&!url&&!initialUrl)fail('Vyber CSV export alebo vlož odkaz na svoj profil.');
      var plan=parsed?planImport(parsed,app().state.books,{readAsComplete:!!fd.get('goodreadsRead')}):null;
      if(parsed&&!plan.importCount&&!url&&!initialUrl)fail('V tomto súbore nie sú nové knihy s platným počtom strán. Skontroluj náhľad importu.');
      app().commit(function(state){if(parsed)importIntoState(state,window.MOModel,parsed,{readAsComplete:!!fd.get('goodreadsRead'),profileUrl:url});else state.settings.goodreadsUrl=url;},plan?plan.importCount+' kníh prenesených z Goodreads.':'Profil Goodreads je uložený.');
    },{submitLabel:'Potvrdiť prenos'});
    var fileInput=document.getElementById('goodreads-file'),readInput=document.getElementById('goodreads-read'),preview=document.getElementById('goodreads-preview'),loadSerial=0;
    function showPreview(){if(parsed)preview.innerHTML=previewHTML(planImport(parsed,app().state.books,{readAsComplete:readAsComplete}));}
    fileInput.addEventListener('change',async function(){var file=fileInput.files[0],token=++loadSerial;parsed=null;fileError='';reading=false;if(!file){preview.innerHTML='<p class="muted">Vyber CSV súbor pre náhľad importu.</p>';return;}reading=true;preview.innerHTML='<p role="status">Načítavam CSV a kontrolujem knihy…</p>';try{if(file.size>MAX_BYTES)fail('CSV súbor môže mať najviac 5 MB.');var text=await file.text();if(token!==loadSerial||serial!==modalSerial||document.getElementById('goodreads-file')!==fileInput||window.MOAuth?.getAccount?.()?.id!==initialAccount)return;parsed=parseCSV(text);showPreview();}catch(error){if(token!==loadSerial||serial!==modalSerial||document.getElementById('goodreads-file')!==fileInput)return;fileError=error.message;preview.innerHTML='<p class="form-error" role="alert">'+esc(fileError)+'</p>';}finally{if(token===loadSerial)reading=false;}});
    readInput.addEventListener('change',function(){readAsComplete=readInput.checked;showPreview();});
  }
  function handleAction(action) { if(action!=='goodreads-open')return false;open();return true; }
  return { parseCSV: parseCSV, planImport: planImport, importIntoState: importIntoState, profileURL: profileURL, handleAction: handleAction };
});
