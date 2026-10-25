(function(){
  'use strict';
  let state=null,selection=null,documents=[],drafts=new Map(),loading=false,reloadQueued=false;
  const bridge=()=>{try{return window.parent!==window&&window.parent.location.origin===location.origin?window.parent.MOLearning:null;}catch{return null;}};
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const key=term=>term.fieldId+':'+term.term.trim().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('sk').replace(/\s+/g,' ');
  function progress(){
    let badges=document.getElementById('learning-progress');
    if(!badges){badges=document.createElement('div');badges.id='learning-progress';badges.className='learning-progress';badges.setAttribute('aria-live','polite');document.querySelector('.diagram-wrap').appendChild(badges);}
    badges.hidden=!state;
    if(!state)return;
    const value=state.progress;
    badges.innerHTML=`<span aria-label="Zapísané definície: ${value.definitions} z ${value.total}"><b aria-hidden="true">⊙</b> ${value.definitions} / ${value.total}</span><span aria-label="Vyzdobené piliere: ${value.gilded} z ${value.pillars}"><b aria-hidden="true">🏛</b> ${value.gilded} / ${value.pillars}</span>`;
    badges.title='Vlastné definície s tromi zdrojmi · trvalo vyzdobené uzly';
    for(const node of value.nodes){
      const target=document.querySelector(`.tree-node[data-id="${node.id}"]`);
      target?.classList.toggle('gilded',node.gilded);
      if(target){const original=window.MOKnowledgeCatalog.sefirot.find(item=>item.id===node.id);target.setAttribute('aria-label',`${original.name}, ${original.translation}; ${original.bridge}; definície ${node.definitions} z ${node.total}${node.gilded?'; zlatý pilier':''}`);}
    }
  }
  async function refresh(){
    if(!bridge())return;
    if(loading){reloadQueued=true;return;}
    loading=true;
    try{state=await bridge().snapshot();progress();}
    catch{/* The standalone map remains available when no game account is open. */}
    finally{loading=false;if(reloadQueued){reloadQueued=false;refresh();}}
  }
  function mount(term,sourceDocuments){
    selection=term;documents=sourceDocuments;
    const panel=document.getElementById('term-assets');
    if(!term?.fieldId)return;
    const host=document.createElement('section');host.className='learning-definition';host.id='learning-definition';panel.appendChild(host);
    if(!bridge()){
      host.innerHTML='<h4>Tvoja vlastná definícia</h4><p>Definície a herné odmeny otvor v Mape stromu priamo v hre.</p><a href="/#library" target="_blank" rel="noopener">Otvoriť hru →</a>';return;
    }
    const termKey=key(term),saved=state?.definitions.find(item=>key(item)===termKey);
    let draft=drafts.get(termKey);
    if(!draft||(!draft.dirty&&draft.expectedRevision!==(saved?.revision||0))){draft={definition:saved?.definition||'',sourceIds:saved?.sources.map(item=>item.id)||[],expectedRevision:saved?.revision||0,dirty:false};drafts.set(termKey,draft);}
    const available=documents.filter(item=>item.blob?.size);
    host.innerHTML=`<p class="eyebrow">TVOJE POZNANIE · ${saved?'ODMENU ZA TENTO POJEM UŽ MÁŠ':'+30 KORÚN'}</p><h4>Vlastná definícia: ${escape(term.term)}</h4><form id="learning-definition-form"><label for="learning-definition-text">Vysvetli pojem vlastnými slovami</label><textarea id="learning-definition-text" rows="5" maxlength="4000" required>${escape(draft.definition)}</textarea><label for="learning-definition-sources">Tri zdroje, z ktorých čerpáš</label><p class="learning-source-help">Nahraj originály nižšie do Dokumentov v aplikácii a vyber tri rôzne súbory. Ten istý obsah pod iným názvom sa počíta iba raz.</p><select id="learning-definition-sources" multiple size="${Math.max(3,Math.min(6,available.length))}" aria-describedby="learning-source-count">${available.map(item=>`<option value="${escape(item.id)}" ${draft.sourceIds.includes(item.id)?'selected':''}>${escape(item.name)}</option>`).join('')}</select><p id="learning-source-count">Vybrané ${draft.sourceIds.filter(id=>available.some(item=>item.id===id)).length} / 3 zdrojov · pri výbere podrž Ctrl alebo ⌘.</p><button id="learning-upload-sources" class="quiet-button" type="button">Nahrať zdroje…</button><p class="learning-definition-status" role="status"></p><button class="quiet-button learning-save" type="submit">${saved?'Uložiť úpravu definície':'Uložiť definíciu a získať 30 korún'}</button></form><p class="learning-rule">Všetky definície uzla odomknú +300 korún a trvalú zlatú farbu. Vlastné definície sa počas hrania objavia na opakovanie.</p>`;
    const form=host.querySelector('form'),text=host.querySelector('textarea'),sources=host.querySelector('select'),status=host.querySelector('.learning-definition-status'),save=host.querySelector('[type=submit]');
    text.addEventListener('input',()=>{draft.definition=text.value;draft.dirty=true;});
    sources.addEventListener('change',()=>{draft.sourceIds=[...sources.selectedOptions].map(option=>option.value);draft.dirty=true;host.querySelector('#learning-source-count').textContent=`Vybrané ${draft.sourceIds.length} / 3 zdrojov`;});
    host.querySelector('#learning-upload-sources').addEventListener('click',()=>document.querySelector('#document-upload').click());
    form.addEventListener('submit',async event=>{
      event.preventDefault();save.disabled=true;
      try{
        const selectedIds=[...sources.selectedOptions].map(option=>option.value);
        if(selectedIds.length!==3)throw Error('Vyber presne tri rôzne nahrané zdroje.');
        const result=await bridge().saveDefinition({fieldId:term.fieldId,term:term.term,definition:text.value,sourceIds:selectedIds,expectedRevision:draft.expectedRevision});
        state={definitions:result.definitions,progress:result.progress};
        draft.dirty=false;draft.definition=text.value;draft.sourceIds=selectedIds;draft.expectedRevision=state.definitions.find(item=>key(item)===termKey).revision;
        status.textContent=result.earned?`Uložené. Získavaš ${result.earned} korún${result.gilded.length?' a zlatý pilier':''}.`:'Úprava uložená. Odmena sa opakovane nepripisuje.';
        save.textContent='Uložiť úpravu definície';progress();
      }catch(error){if(error.definitionRevision)draft.expectedRevision=error.definitionRevision;status.textContent=error.message;}
      finally{save.disabled=false;}
    });
    if(!state)refresh().then(()=>{if(state&&selection===term&&document.getElementById('learning-definition')===host){host.remove();mount(term,documents);}});
  }
  window.MOKnowledgeLearning=Object.freeze({mount,refresh});
  window.addEventListener('message',event=>{if(event.origin===location.origin&&event.source===window.parent&&event.data?.channel==='magnum-opus-learning'&&event.data.version===1&&event.data.type==='changed')refresh();});
  window.MOKnowledgeStore?.onChanged(change=>{if(!change.external)refresh();});
  refresh();
})();
