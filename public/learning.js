(function(){
  'use strict';
  let accountId='',lastInteraction=Date.now(),quiz=null,busy=false,lastShown='',postponed=false;
  const owner=crypto.randomUUID();
  const model=()=>window.MOApp?.model;
  const enabled=()=>window.MOAuth?.isAuthenticated()&&!document.body.classList.contains('auth-locked');
  const esc=value=>window.MOApp.esc(value);
  const fieldName=id=>window.MOKnowledgeCatalog.fields.find(field=>field.id===id)?.name||id;
  const clockKey=()=>`magnum-opus:learning-clock:${accountId}`;
  function writing(){
    let doc=document;
    try{while(doc.activeElement?.tagName==='IFRAME'&&doc.activeElement.contentDocument)doc=doc.activeElement.contentDocument;}catch{return true;}
    return !!doc.querySelector('dialog[open]')||['INPUT','TEXTAREA','SELECT'].includes(doc.activeElement?.tagName);
  }
  function flattenCustom(value){
    return Object.entries(value||{}).filter(([fieldId])=>window.MOKnowledgeCatalog.fields.some(field=>field.id===fieldId)).flatMap(([fieldId,categories])=>Object.values(categories||{}).flatMap(entries=>(entries||[]).map(item=>({fieldId,term:item.term}))));
  }
  async function customTerms(){return flattenCustom(await window.MOKnowledgeStore.getValue('terms',{}));}
  async function snapshot(){
    if(!enabled())throw Error('Najprv otvor svoj herný profil.');
    const custom=await customTerms(),state=window.MOApp.state;
    return {definitions:structuredClone(state.learning.definitions),progress:model().learningProgress(state,custom)};
  }
  async function saveDefinition(input){
    if(!enabled()||busy)throw Error('Ukladanie práve nie je dostupné. Skús o chvíľu.');
    busy=true;
    try{
      if(!Array.isArray(input.sourceIds)||input.sourceIds.length!==3||new Set(input.sourceIds).size!==3)throw Error('Vyber tri rôzne nahrané zdroje.');
      const [documents,custom]=await Promise.all([window.MOKnowledgeStore.getDocuments(),customTerms()]);
      const sources=[];
      for(const documentId of input.sourceIds){
        const document=documents.find(item=>item.id===documentId);
        if(!document?.blob||!document.blob.size)throw Error('Zdroj nemá uložený originál. Nahraj ho v Dokumentoch v aplikácii.');
        const digest=await crypto.subtle.digest('SHA-256',await document.blob.arrayBuffer());
        sources.push({id:document.id,name:document.name,sha256:Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')});
      }
      const result=window.MOApp.commit(state=>model().saveLearningDefinition(state,{fieldId:input.fieldId,term:input.term,definition:input.definition,sources,expectedRevision:input.expectedRevision},custom),undefined,{preserveView:true}).result;
      try{await window.MOAuth.saveNow();}
      catch(error){error.definitionRevision=window.MOApp.state.learning.definitions.find(item=>item.id===result.definitionId)?.revision;error.message+=' Definícia a odmena zostali v miestnom koncepte; použi Uložiť v hre.';throw error;}
      window.MOApp.toast(result.earned?`Poznanie rastie: +${result.earned} korún.`:'Definícia bola upravená.');
      return {...result,...await snapshot()};
    }finally{busy=false;}
  }
  function notifyFrames(){
    for(const id of ['knowledge-library-tree-frame','knowledge-portal-frame'])document.getElementById(id)?.contentWindow?.postMessage({channel:'magnum-opus-learning',version:1,type:'changed'},window.location.origin);
  }
  function dialog(){
    if(quiz)return quiz;
    quiz=document.createElement('dialog');quiz.className='learning-review';quiz.id='learning-review';
    quiz.setAttribute('aria-labelledby','learning-review-title');
    quiz.addEventListener('cancel',event=>{event.preventDefault();postponed=true;quiz.close();});
    document.body.appendChild(quiz);return quiz;
  }
  function showReview(){
    const pending=window.MOApp.state.learning.pending;
    if(!pending||postponed||!enabled()||document.hidden||!document.hasFocus()||writing())return;
    const root=dialog();
    if(root.open)return;
    lastShown=pending.id;
    root.innerHTML=`<form><p class="learning-eyebrow">CHVÍĽA NA POZNANIE · +3 KORUNY</p><h2 id="learning-review-title">Ktorý pojem opisuješ?</h2><p class="learning-review-field">${esc(fieldName(pending.fieldId))}</p><blockquote>${esc(pending.definition)}</blockquote><label for="learning-answer">Názov terminológie</label><input id="learning-answer" name="answer" maxlength="150" autocomplete="off" required><p class="learning-review-status" role="status"></p><div class="learning-review-actions"><button type="button" data-postpone>Neskôr</button><button type="submit">Overiť odpoveď</button></div></form>`;
    root.querySelector('[data-postpone]').addEventListener('click',()=>{postponed=true;root.close();});
    root.querySelector('form').addEventListener('submit',async event=>{
      event.preventDefault();
      if(busy)return;
      busy=true;const button=root.querySelector('[type=submit]');button.disabled=true;
      let committed=false;
      try{
        const answer=root.querySelector('input').value;
        const result=window.MOApp.commit(state=>model().answerLearningReview(state,pending.id,answer),undefined,{preserveView:true}).result;
        committed=true;
        await window.MOAuth.saveNow();
        root.querySelector('.learning-review-status').textContent=result.correct?'Správne! Získavaš 3 koruny.':`Správny pojem: ${result.term}. Tentoraz bez odmeny.`;
        root.querySelector('input').disabled=true;
        button.hidden=true;
        const close=root.querySelector('[data-postpone]');close.textContent='Pokračovať v hre';
        notifyFrames();
      }catch(error){
        root.querySelector('.learning-review-status').textContent=error.message+(committed?' Odpoveď zostala v miestnom koncepte; dokonči uloženie cez Uložiť v hre.':'');
        if(committed){root.querySelector('input').disabled=true;button.hidden=true;root.querySelector('[data-postpone]').textContent='Pokračovať v hre';}
        else button.disabled=false;
      }
      finally{busy=false;}
    });
    root.showModal();
  }
  function readClock(now){
    let clock;
    try{clock=JSON.parse(localStorage.getItem(clockKey())||'null');}catch{throw Error('Čas opakovania sa nepodarilo načítať.');}
    return {total:Math.max(Number.isSafeInteger(clock?.total)?clock.total:0,window.MOApp.state.learning.lastReviewActiveMs),at:Number.isSafeInteger(clock?.at)?clock.at:now};
  }
  async function tick(){
    if(!enabled()||busy)return;
    const current=window.MOAuth.getAccount()?.id;
    if(!current)return;
    if(accountId!==current){accountId=current;lastInteraction=Date.now();lastShown='';postponed=false;}
    const run=async()=>{
      const now=Date.now();
      let clock;
      try{
        clock=window.MOLearningClock.advance(readClock(now),{now,visible:!document.hidden,focused:document.hasFocus(),lastInteraction});
        localStorage.setItem(clockKey(),JSON.stringify(clock));
      }catch{return;}
      const learning=window.MOApp.state.learning;
      if(!learning.definitions.length){localStorage.setItem(clockKey(),JSON.stringify({total:0,at:now}));return;}
      if(document.hidden||!document.hasFocus())return;
      if(!learning.pending&&clock.total-learning.lastReviewActiveMs>=model().LEARNING_INTERVAL){
        // Avoid changing the game while the player is writing in another tool.
        if(writing())return;
        try{
          window.MOApp.commit(state=>model().beginLearningReview(state,clock.total),undefined,{preserveView:true});
          postponed=false;
          await window.MOAuth.saveNow();
        }catch{return;}
      }
      if(learning.pending?.id!==lastShown)postponed=false;
      showReview();
    };
    if(navigator.locks){await navigator.locks.request(clockKey(),{ifAvailable:true},lock=>lock?run():undefined);}
    else{
      // Focus already limits counting to one tab; a short lease covers old browsers.
      const key=clockKey()+':lease';
      try{const lease=JSON.parse(localStorage.getItem(key)||'null');if(lease&&lease.owner!==owner&&lease.until>Date.now())return;localStorage.setItem(key,JSON.stringify({owner,until:Date.now()+1000}));await run();}catch{/* Persistence denied: no automatic question. */}
    }
  }
  function activity(event){if(event.isTrusted)lastInteraction=Date.now();}
  ['pointerdown','pointermove','keydown','wheel','touchstart'].forEach(type=>document.addEventListener(type,activity,{passive:true}));
  function attachFrame(frame){
    try{
      const doc=frame.contentDocument;
      if(!doc||doc.documentElement.dataset.learningActivityBound)return;
      doc.documentElement.dataset.learningActivityBound='1';
      ['pointerdown','pointermove','keydown','wheel','touchstart'].forEach(type=>doc.addEventListener(type,activity,{passive:true}));
    }catch{/* Cross-origin pages are never observed. */}
  }
  function afterRender(){
    if(!enabled()){if(quiz?.open)quiz.close();accountId='';return;}
    notifyFrames();
    document.querySelectorAll('iframe').forEach(frame=>{
      attachFrame(frame);
      if(!frame.dataset.learningLoadBound){frame.dataset.learningLoadBound='1';frame.addEventListener('load',()=>attachFrame(frame));}
    });
    if(window.MOApp.state.learning.pending&&!quiz?.open){
      let resume=document.getElementById('learning-resume');
      if(!resume){resume=document.createElement('button');resume.id='learning-resume';resume.className='learning-resume';resume.textContent='◎ Otázka na poznanie';resume.addEventListener('click',()=>{postponed=false;showReview();});document.body.appendChild(resume);}
    }else document.getElementById('learning-resume')?.remove();
  }
  window.MOLearning=Object.freeze({snapshot,saveDefinition,afterRender});
  setInterval(()=>{tick().catch(()=>{});},5000);
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&quiz?.open){postponed=true;quiz.close();}});
})();
