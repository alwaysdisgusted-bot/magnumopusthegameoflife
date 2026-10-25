(function () {
'use strict';

const store = window.MOKnowledgeStore;
const embedded = new URLSearchParams(window.location.search).get('embed') === '1';
document.documentElement.classList.toggle('embedded', embedded);
const MAX_FILE_BYTES = 15 * 1024 * 1024;
let ready = false, uploadRunning = false, uploadCancelled = false, editingRunning = false, storageBusy = false, externalReloadPending = false;
let downloadURL = '', downloadDocumentId = '';
let gameSearchSerial = 0, gameSearchTimer = null, gameSearchController = null, gameSearchQuery = '';

const {sefirot, fields} = window.MOKnowledgeCatalog;

const positions = [
  [350,54],[515,151],[185,151],[515,295],[185,295],
  [350,366],[515,469],[185,469],[350,572],[350,681]
];
const paths = [[0,1],[0,2],[0,5],[1,2],[1,3],[1,5],[2,4],[2,5],[3,4],[3,5],[3,6],[4,5],[4,7],[5,6],[5,7],[5,8],[6,7],[6,8],[6,9],[7,8],[7,9],[8,9]];
let selectedId = 'keter', selectedField = '', searchTerm = '', activeView = 'bridge';
let selectedTerm = null, readerState = null;
const normalize = value => String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('sk');
const byFieldId = id => fields.find(field => field.id === id);
const bySefirahId = id => sefirot.find(item => item.id === id);
let customAuthors = {};
let customTerms = {};
let termEdit = null;
let libraryDocuments = [];
let grimoireCatalog = {documents:[],links:[],selectedDocuments:[]};
const grimoirePending = new Map();
let grimoireRefresh = 0;
let unifiedQuery = '', unifiedSerial = 0, unifiedTimer = null, unifiedResult = null, unifiedError = '';
let terminologyCatalog = {terms:[],favoriteWords:[],collections:[],folders:[],tabs:[],documents:[]};
let termCreation = null, terminologyBusy = false;
const termDrafts = new Map();
const legacyDrafts = new Map();
const bubbleDrafts = new Map();

function requestTerminology(operation, data = {}) {
  if (!embedded || window.parent === window) return Promise.reject(new Error('Terminológia účtu je dostupná iba priamo v hre.'));
  const requestId = crypto.randomUUID();
  return new Promise((resolve,reject) => {
    const timer = setTimeout(() => { grimoirePending.delete(requestId); reject(new Error('Terminológia neodpovedala. Koncept zostal zachovaný; obnov katalóg pred opakovaním.')); },30000);
    grimoirePending.set(requestId,{resolve,reject,timer});
    window.parent.postMessage({channel:'magnum-opus-knowledge-bridge',version:2,type:'terminology-request',
      requestId,operation,data},window.location.origin);
  });
}

function acceptTerminology(catalog) {
  if (!catalog || !Array.isArray(catalog.terms) || !Array.isArray(catalog.favoriteWords) ||
    !Array.isArray(catalog.collections) || !Array.isArray(catalog.documents) || !Array.isArray(catalog.folders) ||
    !Array.isArray(catalog.tabs)) throw new Error('Server neposlal platný katalóg terminológie.');
  terminologyCatalog = catalog;
}

async function refreshTerminology() {
  if (terminologyBusy) throw new Error('Počkaj na uloženie rozpracovanej zmeny.');
  acceptTerminology(await requestTerminology('list'));
  renderTerminologyWorkspace();
}

function termDetails(term) {
  return Object.fromEntries(['fieldId','categoryId','term','description','note','documentIds','folderIds','collectionIds']
    .map(key => [key,structuredClone(term[key])]).concat(term.parent !== undefined ? [['parent',structuredClone(term.parent)]] : []));
}

function terminologyButton(label, action) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
  button.addEventListener('click',() => { void action().catch(error => {
    document.querySelector('#terminology-status').textContent = error.message;
  }); });
  return button;
}

async function changeLegacy(operation,data) {
  if (terminologyBusy) throw new Error('Predchádzajúca zmena sa ešte ukladá.');
  terminologyBusy = true;
  try { acceptTerminology(await requestTerminology(operation,data)); renderTerminologyWorkspace(); }
  finally { terminologyBusy = false; }
}

function sourcePicker(label, items, selected) {
  const wrapper = document.createElement('label'); wrapper.textContent = label;
  const picker = document.createElement('select'); picker.multiple = true; picker.size = Math.min(6,Math.max(2,items.length));
  picker.setAttribute('aria-label',label);
  for (const item of items) {
    const option = document.createElement('option'); option.value = item.id;
    option.textContent = `${item.name || item.title} · ${item.id.slice(-8)}`;
    option.selected = selected.includes(item.id); picker.append(option);
  }
  wrapper.append(picker);
  return {wrapper,picker};
}

function renderTerminologyWorkspace() {
  const root = document.querySelector('#tree-terminology-content');
  root.replaceChildren();
  for (const term of terminologyCatalog.terms) {
    const section = document.createElement('details'); section.dataset.serverTerm = term.id;
    const summary = document.createElement('summary');
    summary.textContent = `${term.term} · ${term.sourceIds.length} rôznych dokumentov · ${term.rewarded ? '10 korún už pripísaných' : 'odmena čaká na 3 zdroje'}`;
    const form = document.createElement('form'); form.className = 'terminology-source-form';
    const draft = termDrafts.get(term.id) || termDetails(term);
    const noteLabel = document.createElement('label'); noteLabel.textContent = 'Poznámka k termínu';
    const note = document.createElement('textarea'); note.maxLength = 500; note.value = draft.note; noteLabel.append(note);
    const documents = sourcePicker('Dokumenty termínu',terminologyCatalog.documents,draft.documentIds);
    const folders = sourcePicker('Priečinky termínu (vrátane podpriečinkov)',terminologyCatalog.folders,draft.folderIds);
    const collections = sourcePicker('Slovné kolekcie termínu',terminologyCatalog.collections,draft.collectionIds);
    const save = document.createElement('button'); save.type = 'submit'; save.textContent = 'Uložiť zdroje a potvrdiť odmenu';
    const status = document.createElement('p'); status.setAttribute('role','status');
    const values = picker => [...picker.selectedOptions].map(option => option.value);
    const remember = () => termDrafts.set(term.id,{...termDetails(term),note:note.value,
      documentIds:values(documents.picker),folderIds:values(folders.picker),collectionIds:values(collections.picker)});
    form.addEventListener('input',remember); form.addEventListener('change',remember);
    form.addEventListener('submit',async event => {
      event.preventDefault(); remember();
      if (terminologyBusy) { status.textContent = 'Predchádzajúca zmena sa ešte ukladá.'; return; }
      terminologyBusy = true;
      const controls = [...form.querySelectorAll('input,textarea,select,button')];
      controls.forEach(control => { control.disabled = true; });
      try {
        const result = await requestTerminology('save',{id:term.id,expectedRevision:term.revision,details:termDrafts.get(term.id)});
        acceptTerminology(result.catalog); termDrafts.delete(term.id);
        document.querySelector('#terminology-status').textContent = result.awarded
          ? 'Zdroje sú uložené. Server jednorazovo pripísal 10 korún.' : 'Zdroje uložené. Odmena sa neopakuje; vyžaduje aspoň tri rôzne dokumenty.';
        renderTerminologyWorkspace();
        await refreshGrimoire();
      } catch (error) { status.textContent = `${error.message} Rozpísané hodnoty zostali zachované.`; }
      finally { terminologyBusy = false; controls.forEach(control => { control.disabled = false; }); }
    });
    form.append(noteLabel,documents.wrapper,folders.wrapper,collections.wrapper,save,status);
    section.append(summary,terminologyButton('Otvoriť uzol v mape',async () => openSearchNode(term)),form);
    for (const id of term.sourceIds) {
      const documentInfo = terminologyCatalog.documents.find(item => item.id === id);
      section.append(terminologyButton(`Čítať: ${documentInfo?.name || id}`,() => requestGrimoire('open',id)));
    }
    root.append(section);
  }
  const heading = document.createElement('h3'); heading.textContent = 'Pôvodné termíny a slovné kolekcie';
  root.append(heading);
  if (!terminologyCatalog.favoriteWords.length) {
    const empty = document.createElement('p'); empty.textContent = 'Zatiaľ tu nie sú pôvodné slovné kolekcie. Nové vlastné termíny pridávaj vo vybranej vetve mapy.';
    root.append(empty);
  }
  for (const favorite of terminologyCatalog.favoriteWords) {
    const section = document.createElement('details'); section.dataset.legacyTerm = favorite.id;
    const summary = document.createElement('summary'); summary.textContent = favorite.word;
    const note = document.createElement('textarea'); note.maxLength = 500; note.value = favorite.note;
    note.value = legacyDrafts.get(favorite.id)?.note ?? favorite.note;
    note.addEventListener('input',() => legacyDrafts.set(favorite.id,{note:note.value}));
    note.setAttribute('aria-label',`Poznámka: ${favorite.word}`);
    const destination = document.createElement('select'); destination.setAttribute('aria-label','Záložka slovnej kolekcie');
    destination.innerHTML = '<option value="">Samostatná slovná záložka</option>';
    for (const tab of terminologyCatalog.tabs) {
      const option = document.createElement('option'); option.value = tab.id; option.textContent = tab.title; destination.append(option);
    }
    section.append(summary,note,terminologyButton('Uložiť poznámku',async () => {
      await changeLegacy('legacy-note',{id:favorite.id,note:note.value}); legacyDrafts.delete(favorite.id);
    }),
      destination,terminologyButton('Vytvoriť slovnú kolekciu',() => changeLegacy('legacy-collection',{id:favorite.id,parentTabId:destination.value || null})));
    for (const collection of terminologyCatalog.collections.filter(item => item.favoriteId === favorite.id)) {
      const card = document.createElement('details'); card.dataset.wordCollection = collection.id;
      const title = document.createElement('summary'); title.textContent = `${collection.title} · ${collection.sourceIds.length} dokumentov`;
      const name = document.createElement('input'); name.maxLength = 120; name.value = collection.title; name.setAttribute('aria-label','Názov kolekcie');
      const description = document.createElement('textarea'); description.maxLength = 500; description.value = collection.note; description.setAttribute('aria-label','Poznámka kolekcie');
      name.value = legacyDrafts.get(collection.id)?.title ?? collection.title;
      description.value = legacyDrafts.get(collection.id)?.note ?? collection.note;
      const remember = () => legacyDrafts.set(collection.id,{title:name.value,note:description.value});
      name.addEventListener('input',remember); description.addEventListener('input',remember);
      const picker = document.createElement('select'); picker.setAttribute('aria-label','Pridať dokument do kolekcie');
      for (const item of terminologyCatalog.documents) {
        const option = document.createElement('option'); option.value = item.id; option.textContent = `${item.name} · ${item.id.slice(-8)}`; picker.append(option);
      }
      const folder = document.createElement('select'); folder.setAttribute('aria-label','Priečinok nahrávania kolekcie');
      for (const item of terminologyCatalog.folders) {
        const option = document.createElement('option'); option.value = item.id; option.textContent = item.title; option.selected = item.id === collection.uploadFolderId; folder.append(option);
      }
      card.append(title,name,description,terminologyButton('Uložiť názov a text kolekcie',async () => {
        await changeLegacy('legacy-details',{id:collection.id,title:name.value,note:description.value}); legacyDrafts.delete(collection.id);
      }),picker,
      terminologyButton('Pridať dokument do kolekcie',async () => {
        if (!picker.value) throw new Error('Najprv nahraj dokument do Grimoára.');
        await changeLegacy('legacy-include',{id:collection.id,targetId:picker.value});
      }),folder,terminologyButton('Pripojiť priečinok nahrávania',async () => {
        if (!folder.value) throw new Error('Najprv vytvor priečinok v Grimoári.');
        await changeLegacy('legacy-folder',{id:collection.id,targetId:folder.value});
      }));
      for (const id of collection.sourceIds) {
        const item = terminologyCatalog.documents.find(documentInfo => documentInfo.id === id);
        const row = document.createElement('p');
        row.append(terminologyButton(item?.name || id,() => requestGrimoire('open',id)),
          terminologyButton('Odpojiť (ponechať originál)',() => changeLegacy('legacy-exclude',{id:collection.id,targetId:id})));
        card.append(row);
      }
      section.append(card);
    }
    root.append(section);
  }
}

if (embedded) {
  document.querySelector('#tree-terminology').hidden = false;
  document.querySelector('#refresh-terminology').addEventListener('click',() => {
    void refreshTerminology().catch(error => { document.querySelector('#terminology-status').textContent = error.message; });
  });
  document.querySelector('#tree-terminology').addEventListener('toggle',event => {
    if (event.target.open && !document.querySelector('#tree-terminology-content').childElementCount) {
      void refreshTerminology().catch(error => { document.querySelector('#terminology-status').textContent = error.message; });
    }
  });
}

function requestGrimoire(operation, documentId = '', node = null, query = '') {
  if (!embedded || window.parent === window) return Promise.reject(new Error('Prepojenie dokumentov otvor v Mape stromu priamo v hre.'));
  const requestId = crypto.randomUUID();
  return new Promise((resolve,reject) => {
    const timer = setTimeout(() => {
      grimoirePending.delete(requestId);
      reject(new Error('Grimoár neodpovedal. Otvor hlavnú knižnicu a skús znova.'));
    },30000);
    grimoirePending.set(requestId,{resolve,reject,timer});
    window.parent.postMessage({
      channel:'magnum-opus-knowledge-bridge',version:2,
      requestId,operation,documentId,
      ...(['search','open-search'].includes(operation) ? {type:'search-request',query} : {type:'document-request',node})
    },window.location.origin);
  });
}

window.addEventListener('message',event => {
  const message = event.data;
  if (event.origin !== window.location.origin || event.source !== window.parent ||
    !message || Object.keys(message).sort().join('|') !== ['channel','version','type','requestId','ok','error','result'].sort().join('|') ||
    message.channel !== 'magnum-opus-knowledge-bridge' || message.version !== 2 ||
    message.type !== 'document-response' || typeof message.ok !== 'boolean' || typeof message.error !== 'string') return;
  const pending = grimoirePending.get(message.requestId);
  if (!pending) return;
  clearTimeout(pending.timer); grimoirePending.delete(message.requestId);
  if (message.ok) pending.resolve(message.result);
  else pending.reject(new Error(message.error || 'Prepojenie dokumentu zlyhalo.'));
});

window.addEventListener('message',event => {
  const message = event.data;
  if (!embedded || event.origin !== window.location.origin || event.source !== window.parent ||
    !message || message.channel !== 'magnum-opus-knowledge-bridge' || message.version !== 2) return;
  const keys = Object.keys(message).sort().join('|');
  if (keys === ['channel','version','type','query'].sort().join('|') && message.type === 'query-changed' &&
    typeof message.query === 'string' && message.query.length <= 150 && !/[\u0000-\u001f\u007f]/.test(message.query)) {
    if (searchTerm === message.query) return;
    searchTerm = message.query; selectedTerm = null; readerState = null;
    document.querySelector('#search').value = searchTerm;
    if (searchTerm) activeView = 'overview';
    render();
  } else if (keys === ['channel','version','type'].sort().join('|') && message.type === 'refresh-catalog' && ready) {
    void refreshGrimoire().catch(error => storageMessage(error.message));
  } else if (keys === ['channel','version','type','node'].sort().join('|') && message.type === 'open-map-node' &&
    message.node && Object.keys(message.node).sort().join('|') === ['fieldId','categoryId','term'].sort().join('|') &&
    typeof message.node.fieldId === 'string' && typeof message.node.categoryId === 'string' && typeof message.node.term === 'string') {
    let error = '';
    try { openSearchNode(message.node); }
    catch (failure) { error = failure.message; storageMessage(error); }
    window.parent.postMessage({
      channel:'magnum-opus-knowledge-bridge',version:2,type:'node-response',node:message.node,ok:!error,error
    },window.location.origin);
  }
});

function openSearchNode(node) {
  if (!ready) throw new Error('Mapa ešte nie je pripravená.');
  const field = byFieldId(node.fieldId), category = field?.categories.find(item => item.id === node.categoryId);
  const term = category && termEntriesFor(field,category).find(item => item.term === node.term);
  if (!term) throw new Error('Uzol už nie je dostupný. Obnov katalóg mapy.');
  selectedField = field.id;
  selectedId = sefirot.find(item => item.fields.includes(field.id))?.id || 'keter';
  selectedTerm = {...node,description:term.description,customIndex:termsFor(field,category).findIndex(item => item.term === term.term)};
  readerState = null; activeView = 'map';
  render();
  window.MOKnowledgeFieldMap?.focusSelection();
  const bubble = document.querySelector('.field-graph-term[aria-pressed="true"]');
  if (bubble) {
    document.querySelector('#field-map-view').scrollIntoView({block:'start',behavior:'auto'});
    bubble.focus({preventScroll:true});
  }
}

function scheduleUnifiedSearch(value) {
  const query = String(value || '').trim().slice(0,150);
  if (query === unifiedQuery) return;
  unifiedQuery = query; unifiedError = ''; unifiedResult = null;
  const serial = ++unifiedSerial;
  clearTimeout(unifiedTimer);
  if ((query.normalize('NFC').match(/\p{L}/gu) || []).length < 3) {
    renderUnifiedResults(query); return;
  }
  unifiedTimer = setTimeout(async () => {
    try {
      const result = await requestGrimoire('search','',null,query);
      if (serial !== unifiedSerial) return;
      if (!result || result.query !== query || !Array.isArray(result.documents) ||
        !Array.isArray(result.nodes) || !Array.isArray(result.errors)) throw new Error('Spoločné vyhľadávanie vrátilo neplatné výsledky.');
      unifiedResult = result;
    } catch (error) {
      if (serial !== unifiedSerial) return;
      unifiedError = error.message;
    }
    renderUnifiedResults(query);
  },180);
}

function renderUnifiedResults(query) {
  const panel = document.querySelector('#search-results');
  panel.hidden = !query;
  panel.replaceChildren();
  if (!query) return;
  const heading = document.createElement('h2'); heading.textContent = `Spoločné vyhľadávanie · ${query}`;
  panel.append(heading);
  const note = document.createElement('p'); note.className = 'library-note';
  note.textContent = 'Výsledky z celého Grimoára a mapových uzlov. Vyhľadávanie nepridáva dokumenty do mapy.';
  panel.append(note);
  if ((query.normalize('NFC').match(/\p{L}/gu) || []).length < 3) {
    note.textContent = 'Vyhľadávanie sa začne od 3 písmen.'; return;
  }
  if (unifiedError) { note.textContent = `Vyhľadávanie zlyhalo: ${unifiedError}`; return; }
  if (!unifiedResult || unifiedResult.query !== query) { note.textContent = 'Vyhľadávam v spoločnom katalógu…'; return; }
  for (const error of unifiedResult.errors) {
    const warning = document.createElement('p'); warning.setAttribute('role','alert');
    warning.textContent = `Čiastočné výsledky: ${error}`; panel.append(warning);
  }
  for (const result of unifiedResult.documents) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'matching-document';
    button.dataset.grimoireResult = result.documentId;
    const icon = document.createElement('span'); icon.className = 'document-icon'; icon.textContent = '▤'; icon.setAttribute('aria-hidden','true');
    const title = document.createElement('strong'); title.className = 'matching-document-name'; title.textContent = result.title;
    const summary = document.createElement('span'); summary.className = 'match-summary';
    summary.textContent = `${result.occurrences} výskytov${result.occurrence?.pageNumber !== undefined ? ` · Strana ${result.occurrence.pageNumber}` : ''} · Otvoriť v Grimoári →`;
    const excerpt = document.createElement('span'); excerpt.className = 'match-snippet';
    excerpt.innerHTML = highlightedGameText(result.excerpt,query,Infinity,true);
    button.append(icon,title,summary,excerpt);
    button.addEventListener('click',async () => {
      button.disabled = true;
      try { await requestGrimoire('open-search',result.documentId,null,query); }
      catch (error) { storageMessage(`Dokument sa neotvoril: ${error.message}`); }
      finally { button.disabled = false; }
    });
    panel.append(button);
  }
  for (const node of unifiedResult.nodes) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'overview-link';
    button.classList.add('search-terminology-link');
    const label = document.createElement('span');
    const title = document.createElement('strong'); title.textContent = node.term;
    const context = document.createElement('small'); context.textContent = `Termín v mape · ${node.title}`;
    label.append(title,context);
    const arrow = document.createElement('span'); arrow.textContent = '→'; arrow.setAttribute('aria-hidden','true');
    button.append(label,arrow);
    button.addEventListener('click',() => {
      try { openSearchNode({fieldId:node.fieldId,categoryId:node.categoryId,term:node.term}); }
      catch (error) { storageMessage(error.message); }
    });
    panel.append(button);
  }
  for (const source of unifiedResult.sources || []) {
    const url = gameResultURL(source.url);
    if (!url) continue;
    const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.textContent = `Hra · ${source.title}`; panel.append(link);
  }
  if (!unifiedResult.documents.length && !unifiedResult.nodes.length && !unifiedResult.sources?.length) {
    const empty = document.createElement('p'); empty.textContent = 'Zadaný text sa v dokumentoch ani terminológii nenašiel.'; panel.append(empty);
  }
}

function mapNode() {
  return selectedTerm?.fieldId && selectedTerm?.categoryId
    ? {fieldId:selectedTerm.fieldId,categoryId:selectedTerm.categoryId,term:selectedTerm.term} : null;
}

function mappedDocuments() {
  return [...libraryDocuments.map(item => embedded
    ? {...item,id:`map:${encodeURIComponent(item.id)}`,mapDocumentId:item.id} : item),
  ...grimoireCatalog.selectedDocuments.map(item => ({
    ...item,id:`grimoire:${item.id}`,grimoireId:item.id,pageKind:'original'
  }))];
}

async function refreshGrimoire() {
  if (!embedded) return;
  const serial = ++grimoireRefresh;
  const result = await requestGrimoire('catalog');
  if (serial !== grimoireRefresh) return;
  if (!result || !Array.isArray(result.documents) || !Array.isArray(result.links) || !Array.isArray(result.selectedDocuments)) {
    throw new Error('Grimoár vrátil neplatný katalóg.');
  }
  grimoireCatalog = result;
  if (Array.isArray(result.terms)) terminologyCatalog.terms = result.terms;
  if (result.errors?.length) storageMessage(`Čiastočný katalóg: ${result.errors.join(' ')}`);
  renderDocumentLibrary();
  renderTermAssets();
}

function renderGrimoireLinks(panel) {
  const node = mapNode();
  if (!embedded || !node) return;
  const section = document.createElement('section');
  section.className = 'map-document-links';
  const heading = document.createElement('h4'); heading.textContent = 'Dokumenty priradené k tomuto uzlu';
  const serverTerm = terminologyCatalog.terms.find(item => item.fieldId === node.fieldId &&
    item.categoryId === node.categoryId && item.term === node.term);
  if (serverTerm) {
    section.append(heading,terminologyButton('Spravovať zdroje, poznámku a odmenu',async () => {
      await refreshTerminology();
      document.querySelector('#tree-terminology').open = true;
      const target = [...document.querySelectorAll('[data-server-term]')].find(item => item.dataset.serverTerm === serverTerm.id);
      if (target) { target.open = true; target.scrollIntoView({block:'nearest'}); }
    }));
    for (const id of serverTerm.sourceIds) {
      const item = grimoireCatalog.documents.find(documentInfo => documentInfo.id === id);
      section.append(terminologyButton(`Čítať: ${item?.name || id}`,() => requestGrimoire('open',id)));
    }
    panel.append(section);
    return;
  }
  const picker = document.createElement('select'); picker.setAttribute('aria-label','Dokument z Grimoára');
  const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Vyber dokument z úplného Grimoára';
  picker.append(placeholder);
  for (const item of grimoireCatalog.documents) {
    const option = document.createElement('option'); option.value = item.id;
    option.textContent = `${item.name} · ${item.id.slice(-8)}`;
    picker.append(option);
  }
  const add = document.createElement('button'); add.type = 'button'; add.textContent = 'Pridať odkaz do uzla';
  const feedback = document.createElement('p'); feedback.setAttribute('role','status');
  section.append(heading,picker,add,feedback);
  const change = async (operation,id) => {
    add.disabled = true;
    try {
      const result = await requestGrimoire(operation,id,node);
      grimoireCatalog = result;
      renderDocumentLibrary(); renderTermAssets();
    } catch (error) {
      feedback.textContent = error.message;
      storageMessage(error.message);
    } finally { add.disabled = false; }
  };
  add.addEventListener('click',() => {
    if (!picker.value) { feedback.textContent = 'Najprv vyber dokument.'; return; }
    void change('link',picker.value);
  });
  const reload = document.createElement('button'); reload.type = 'button'; reload.textContent = 'Obnoviť katalóg Grimoára';
  reload.addEventListener('click',() => { void refreshGrimoire().catch(error => { feedback.textContent = error.message; }); });
  section.append(reload);
  for (const link of grimoireCatalog.links.filter(item =>
    item.fieldId === node.fieldId && item.categoryId === node.categoryId && item.term === node.term)) {
    const documentInfo = grimoireCatalog.documents.find(item => item.id === link.documentId);
    const row = document.createElement('p');
    const open = document.createElement('button'); open.type = 'button'; open.textContent = documentInfo?.name || 'Nedostupný dokument';
    open.addEventListener('click',() => { void requestGrimoire('open',link.documentId)
      .catch(error => { feedback.textContent = error.message; }); });
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Odpojiť od uzla (ponechať originál)';
    remove.addEventListener('click',() => { void change('unlink',link.documentId); });
    row.append(open,remove); section.append(row);
  }
  panel.append(section);
}
let authorStorageWarning = '';
let termStorageWarning = '';

async function loadCustomAuthors() {
  try {
    const parsed = await store.getValue('authors', {});
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Neplatný formát');
    for (const categories of Object.values(parsed)) {
      if (!categories || typeof categories !== 'object' || Array.isArray(categories)) throw new Error('Neplatná vetva');
      for (const names of Object.values(categories)) {
        if (!Array.isArray(names) || names.length > 200 || names.some(name => typeof name !== 'string' || !name.trim() || name.length > 200)) throw new Error('Neplatný autor');
      }
    }
    // Preserve valid imports verbatim, including branches absent from this catalog.
    customAuthors = parsed;
    authorStorageWarning = '';
  } catch (error) {
    authorStorageWarning = 'Uložený zoznam autorov sa nepodarilo načítať.';
    throw error;
  }
}

async function saveCustomAuthors(proposal, expected) {
  try {
    customAuthors = await store.setValue('authors', proposal, expected);
    authorStorageWarning = '';
    return true;
  } catch (error) {
    if (error.code === 'value_conflict') externalReloadPending = true;
    authorStorageWarning = `Autor nebol pridaný. ${error.message || 'Skontroluj voľné miesto a oprávnenia úložiska.'}`;
    return false;
  }
}

async function loadCustomTerms() {
  try {
    const parsed = await store.getValue('terms', {});
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Neplatný formát');
    for (const categories of Object.values(parsed)) {
      if (!categories || typeof categories !== 'object' || Array.isArray(categories)) throw new Error('Neplatná vetva');
      for (const entries of Object.values(categories)) {
        if (!Array.isArray(entries) || entries.length > 500 || entries.some(entry => !entry || typeof entry.term !== 'string' || !entry.term.trim() || entry.term.length > 150 || typeof entry.description !== 'string' || entry.description.length > 2000)) throw new Error('Neplatný pojem');
      }
    }
    // Preserve valid imports, including unknown branches and blank/long descriptions.
    customTerms = parsed;
    if (selectedTerm?.fieldId) {
      const field = byFieldId(selectedTerm.fieldId);
      const category = field?.categories.find(item => item.id === selectedTerm.categoryId);
      const entry = category && termEntriesFor(field,category).find(item => item.term === selectedTerm.term);
      if (entry) selectedTerm = {...selectedTerm,description:entry.description,customIndex:termsFor(field,category).indexOf(entry)};
      else { selectedTerm = null; readerState = null; }
    }
  } catch (error) {
    termStorageWarning = 'Uloženú terminológiu sa nepodarilo načítať.';
    throw error;
  }
}

async function saveCustomTerms(proposal, expected) {
  try {
    customTerms = await store.setValue('terms', proposal, expected);
    termStorageWarning = '';
    return true;
  } catch (error) {
    if (error.code === 'value_conflict') externalReloadPending = true;
    termStorageWarning = `Zmena pojmu sa neuložila. ${error.message || 'Skontroluj voľné miesto a oprávnenia úložiska.'}`;
    return false;
  }
}

async function loadDocuments() {
  try {
    const parsed = await store.getDocuments();
    if (!Array.isArray(parsed)) throw new Error('Neplatný formát');
    libraryDocuments = parsed.filter(document =>
      document && typeof document.id === 'string' && typeof document.name === 'string' &&
      typeof document.text === 'string' && Array.isArray(document.pages)
    ).map(document => ({
      ...document,
      id: document.id,
      name: document.name.slice(0, 255),
      text: document.text,
      pageKind: document.pageKind === 'original' ? 'original' : 'virtual',
      pages: document.pages.filter(page => page && typeof page.text === 'string').map((page,index) => ({number:page.number || index+1,text:page.text}))
    }));
  } catch (error) {
    throw error;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[character]);
}

function authorsFor(field, category) {
  const additions = customAuthors[field.id]?.[category.id] || [];
  return [...new Set([...category.authors, ...additions])];
}

function termsFor(field, category) {
  return [...(customTerms[field.id]?.[category.id] || []),
    ...(embedded ? terminologyCatalog.terms.filter(item => item.fieldId === field.id && item.categoryId === category.id)
      .map(item => ({term:item.term,description:item.description,serverId:item.id,parent:item.parent})) : [])];
}

function catalogTermsFor(field) {
  const added = field.categories.flatMap(category => termsFor(field, category).map(item => item.term));
  return [...new Set([...field.terms, ...field.categories.flatMap(category=>category.terms), ...added])];
}

function termEntriesFor(field, category) {
  return [
    ...category.terms.map(term => ({term, description:''})),
    ...termsFor(field, category)
  ];
}

function fieldSearchText(field) {
  return `${field.name} ${field.description} ${field.terms.join(' ')} ${field.ref} ${field.categories.map(category =>
    `${category.name} ${category.terms.join(' ')} ${authorsFor(field, category).join(' ')} ${termsFor(field, category).map(item => `${item.term} ${item.description}`).join(' ')}`
  ).join(' ')}`;
}

function normalizedTextWithOffsets(text) {
  let normalized = '';
  const starts = [], ends = [];
  for (let index = 0; index < text.length;) {
    const character = String.fromCodePoint(text.codePointAt(index));
    const end = index + character.length;
    const folded = normalize(character);
    for (let foldedIndex = 0; foldedIndex < folded.length; foldedIndex++) {
      normalized += folded[foldedIndex];
      starts.push(index);
      ends.push(end);
    }
    index = end;
  }
  return {normalized,starts,ends};
}

function findTextRanges(text, term, contiguous = false) {
  const needle = normalize(term);
  if (!needle) return [];
  const {normalized,starts,ends} = normalizedTextWithOffsets(text);
  const ranges = [];
  let position = 0;
  while ((position = normalized.indexOf(needle,position)) !== -1) {
    const before = normalized[position - 1] || '';
    const after = normalized[position + needle.length] || '';
    const isWordCharacter = character => /[\p{L}\p{N}]/u.test(character);
    if (contiguous || (!isWordCharacter(before) && !isWordCharacter(after))) {
      ranges.push({start:starts[position],end:ends[position + needle.length - 1]});
    }
    position += needle.length;
  }
  return ranges;
}

function pagesForText(text) {
  if (text.includes('\f')) {
    return {pageKind:'original',pages:text.split('\f').map((page,index) => ({number:index+1,text:page}))};
  }
  const pages = [];
  let start = 0;
  const pageSize = 1800;
  while (start < text.length) {
    let end = Math.min(start + pageSize,text.length);
    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf('\n\n',end);
      const wordBreak = text.lastIndexOf(' ',end);
      const boundary = paragraphBreak > start + pageSize * .55 ? paragraphBreak + 2 : wordBreak;
      if (boundary > start + pageSize * .55) end = boundary;
    }
    pages.push({number:pages.length+1,text:text.slice(start,end)});
    start = end;
  }
  return {pageKind:'virtual',pages:pages.length ? pages : [{number:1,text:''}]};
}

function documentMatches(document, term) {
  const matches = [];
  document.pages.forEach((page,index) => {
    const ranges = findTextRanges(page.text,term);
    if (ranges.length) matches.push({page:index,ranges});
  });
  return matches;
}

function renderDocumentLibrary() {
  const documents = mappedDocuments();
  document.querySelector('#document-count').textContent = `${documents.length} dokumentov`;
  document.querySelector('#document-list').innerHTML = documents.length
    ? documents.map(item => `<button type="button" class="document-row" data-document="${escapeHtml(item.id)}"><span class="document-icon" aria-hidden="true">${/^image\//.test(item.mime) ? '▧' : '▤'}</span><span class="document-name">${escapeHtml(item.name)}${item.warning ? `<small class="document-warning">${escapeHtml(item.warning)}</small>` : ''}</span><span class="document-pages">${escapeHtml(paginationLabel(item))}</span></button>`).join('')
    : '<p class="empty-library">Zatiaľ tu nie sú pridané žiadne dokumenty.</p>';
  document.querySelectorAll('#document-list [data-document]').forEach(button => button.addEventListener('click', () => {
    selectedTerm = {term:searchTerm,description:''};
    openDocumentMatch(button.dataset.document,0);
  }));
  renderGlobalResults();
}

function paginationLabel(item) {
  if (item.mime === 'application/pdf') return `${item.pages.length} prepísaných pôvodných strán PDF`;
  if (/^image\//.test(item.mime)) return 'Fotografia · lokálny prepis';
  if (item.pageKind === 'original') return `${item.pages.length} častí oddelených v texte`;
  return `${item.pages.length} virtuálnych strán · bez pevnej paginácie`;
}

function documentResults(query) {
  return mappedDocuments().map(document => ({document,matches:documentMatches(document,query),nameMatch:findTextRanges(document.name,query).length > 0}))
    .filter(result => result.matches.length || result.nameMatch);
}

function matchSnippet(result) {
  const first = result.matches[0];
  if (!first) return 'Zhoda v názve dokumentu; otvorí sa jeho začiatok.';
  const text = result.document.pages[first.page].text, range = first.ranges[0];
  const start = Math.max(0,range.start-70), end = Math.min(text.length,range.end+110);
  return `${start ? '…' : ''}${escapeHtml(text.slice(start,range.start))}<mark>${escapeHtml(text.slice(range.start,range.end))}</mark>${escapeHtml(text.slice(range.end,end))}${end < text.length ? '…' : ''}`;
}

function resultsHTML(results) {
  return results.map(result => `<button class="matching-document" type="button" data-document="${escapeHtml(result.document.id)}">
    <span class="document-icon" aria-hidden="true">▤</span><span class="matching-document-name">${escapeHtml(result.document.name)}</span>
    <span class="match-summary">${result.matches.reduce((sum,item)=>sum+item.ranges.length,0)} výskytov v texte${result.nameMatch ? ' · zhoda v názve' : ''}${result.matches.length ? ` · ${result.document.pageKind === 'original' ? 'strany / časti' : 'virtuálne strany'} ${result.matches.map(item=>result.document.pages[item.page].number).join(', ')}` : ''}</span>
    <span class="match-snippet">${matchSnippet(result)}</span></button>`).join('');
}

function bindDocumentResults(panel,query) {
  panel.querySelectorAll('[data-document]').forEach(button => button.addEventListener('click', () => {
    selectedTerm = {term:query,description:'Vyhľadávanie v lokálnej knižnici.'};
    openDocumentMatch(button.dataset.document,0);
  }));
}

function renderGlobalResults() {
  if (embedded) {
    const query = selectedTerm?.term || searchTerm;
    if (query !== searchTerm) { searchTerm = query; document.querySelector('#search').value = query; }
    scheduleUnifiedSearch(query);
    renderUnifiedResults(query);
    return;
  }
  scheduleGameSearch(selectedTerm?.term || searchTerm);
  const panel = document.querySelector('#search-results');
  panel.hidden = !searchTerm;
  if (!searchTerm) return;
  const results = documentResults(searchTerm);
  panel.innerHTML = `<div class="catalog-heading"><h2>Slovo „${escapeHtml(searchTerm)}“ v dokumentoch</h2><span class="result-count">${results.length} dokumentov</span></div><p class="library-note">Hľadá sa v názvoch aj v uloženom prepise, aj keď slovo ešte nie je v pojmovej mape.</p>${results.length ? `<div class="matching-documents">${resultsHTML(results,searchTerm)}</div>` : `<p class="empty-library">V uložených názvoch a prepisoch sa slovo nenašlo.${libraryDocuments.length ? ' Pôvodné súbory môžeš otvoriť v knižnici nižšie.' : ' Najprv pridaj svoje dokumenty.'}</p>`}`;
  bindDocumentResults(panel,searchTerm);
}

function cancelGameSearch() {
  gameSearchSerial += 1;
  if (gameSearchTimer !== null) clearTimeout(gameSearchTimer);
  gameSearchTimer = null;
  gameSearchController?.abort();
  gameSearchController = null;
}

function gameSearchHeading(query) {
  return `<div class="catalog-heading"><h2>Zhody v hre · „${escapeHtml(query)}“</h2></div><p class="library-note">Existujúce poznámky, stôl a Pracovňa sa prehľadávajú iba na čítanie a vyžadujú miestnu hernú reláciu. Výsledky sa neukladajú do tejto knižnice ani jej záloh. Odkaz otvorí pôvodnú sekciu so zvýrazneným slovom.</p>`;
}

function gameResultURL(value) {
  if (typeof value !== 'string' || value.length > 3000) return '';
  try {
    const url = new URL(value,window.location.href);
    return /^https?:$/.test(url.protocol) && url.origin === window.location.origin && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function highlightedGameText(value,query,limit,contiguous = false) {
  const text = String(value || '').slice(0,limit), ranges = findTextRanges(text,query,contiguous);
  let result = '', cursor = 0;
  for (const range of ranges) {
    result += `${escapeHtml(text.slice(cursor,range.start))}<mark>${escapeHtml(text.slice(range.start,range.end))}</mark>`;
    cursor = range.end;
  }
  return result + escapeHtml(text.slice(cursor));
}

function renderGameResults(query,response) {
  if (!response || !Array.isArray(response.results)) throw new Error('Herné vyhľadávanie nevrátilo platnú odpoveď.');
  const panel = document.querySelector('#game-search-results');
  const errors = Array.isArray(response.errors) ? response.errors.slice(0,6).map(error => String(typeof error === 'string' ? error : error?.message || 'Niektorú sekciu hry sa nepodarilo prehľadať.').slice(0,240)) : [];
  const visibleResults = response.results;
  const results = visibleResults.slice(0,40).map(result => ({...result,safeURL:gameResultURL(result?.url)})).filter(result => result.safeURL);
  if (results.length < Math.min(40,visibleResults.length)) errors.push('Niektoré odkazy na pôvodné záznamy nie je možné otvoriť.');
  const kinds = {desk:'Stôl','desk-note':'Alchymistický stôl · lístok','desk-photo':'Alchymistický stôl · fotografia',page:'Pracovňa',workspace:'Pracovňa',daynote:'Denná poznámka','day-note':'Denná poznámka',study:'Štúdium',book:'Knižné poznámky',note:'Poznámka'};
  panel.innerHTML = gameSearchHeading(query)
    + (errors.length ? `<div class="game-search-error" role="status"><strong>Vyhľadávanie v hre nie je úplné.</strong>${errors.map(error => `<p>${escapeHtml(error)}</p>`).join('')}</div>` : '')
    + (results.length ? `<div class="game-matches">${results.map(result => `<a class="game-search-result" href="${escapeHtml(result.safeURL)}" target="_blank" rel="noopener noreferrer"><span class="game-result-kind">${escapeHtml(kinds[result.kind] || 'Herný záznam')}</span><strong>${highlightedGameText(result.title || 'Bez názvu',query,180)} <span aria-hidden="true">↗</span></strong><span class="game-result-snippet">${highlightedGameText(result.snippet || result.text || '',query,460)}</span><span class="game-result-count">${Number.isSafeInteger(result.occurrences) && result.occurrences > 0 ? `${result.occurrences} výskytov` : 'Zhoda v pôvodnom zázname'}</span></a>`).join('')}</div><p class="library-note">${response.results.length > 40 ? 'Zobrazených je prvých 40 záznamov; spresni hľadané slovo.' : `${results.length} súvisiacich herných záznamov.`}</p>` : errors.length ? '' : '<p class="empty-library">V dostupných herných poznámkach sa slovo nenašlo.</p>');
  panel.setAttribute('aria-busy','false');
}

function scheduleGameSearch(value) {
  if (embedded) { document.querySelector('#game-search-results').hidden = true; return; }
  const query = String(value || '').trim().slice(0,200);
  if (query === gameSearchQuery) return;
  cancelGameSearch();
  gameSearchQuery = query;
  const panel = document.querySelector('#game-search-results');
  panel.hidden = !query;
  if (!query) { panel.replaceChildren(); panel.setAttribute('aria-busy','false'); return; }
  const serial = gameSearchSerial, controller = new AbortController();
  gameSearchController = controller;
  panel.setAttribute('aria-busy','true');
  panel.innerHTML = gameSearchHeading(query) + '<p class="game-search-loading" role="status">Vyhľadávam v existujúcich herných poznámkach…</p>';
  gameSearchTimer = setTimeout(async () => {
    gameSearchTimer = null;
    try {
      if (!window.MOKnowledgeGameSearch?.search) throw new Error('Herné vyhľadávanie sa nenačítalo. Obnov stránku pri spustenej lokálnej hre.');
      const response = await window.MOKnowledgeGameSearch.search(query,{signal:controller.signal});
      if (serial !== gameSearchSerial || controller.signal.aborted) return;
      renderGameResults(query,response);
    } catch (error) {
      if (serial !== gameSearchSerial || controller.signal.aborted) return;
      const message = error?.name === 'AbortError' ? 'Vyhľadávanie bolo prerušené. Zadaj hľadané slovo znova.' : error?.message || 'Herné poznámky sa nepodarilo načítať. Skontroluj miestnu hernú reláciu.';
      panel.innerHTML = gameSearchHeading(query) + `<p class="game-search-error" role="status">${escapeHtml(message)}</p>`;
      panel.setAttribute('aria-busy','false');
      gameSearchQuery = '';
    } finally { if (serial === gameSearchSerial) gameSearchController = null; }
  },250);
}

function renderTermAssets() {
  const panel = document.querySelector('#term-assets');
  scheduleGameSearch(selectedTerm?.term || searchTerm);
  if (!selectedTerm) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const results = embedded ? [] : documentResults(selectedTerm.term);
  panel.innerHTML = `<div class="term-assets-heading">
    <span class="term-visual selected">${escapeHtml(selectedTerm.term)}</span>
    <div><h4>Dokumenty obsahujúce tento termín</h4><p>${escapeHtml(selectedTerm.description || 'Výskyty presného textového termínu v lokálnej knižnici.')}</p></div>
  </div>
  ${embedded ? '<button class="overview-link" id="search-in-grimoire" type="button">Vyhľadať tento pojem v hlavnej knižnici →</button>' : ''}
  ${embedded ? '<p class="library-note">Výskyty vo všetkých dokumentoch sú v spoločných výsledkoch vyhľadávania. Do mapy patria iba pridané odkazy nižšie.</p>' : `${results.length ? `<div class="matching-documents">${resultsHTML(results,selectedTerm.term)}</div>` : `<p class="empty-library">V uložených prepisoch sa tento termín zatiaľ nenašiel.</p><button class="overview-link" id="browse-library" type="button">Otvoriť knižnicu všetkých súborov ↓</button>`}<button class="overview-link" id="show-game-matches" type="button">Prejsť na zhody v existujúcich herných poznámkach ↑</button>`}`;
  panel.querySelector('#search-in-grimoire')?.addEventListener('click',() => {
    const field = byFieldId(selectedTerm.fieldId), category = field?.categories.find(item => item.id === selectedTerm.categoryId);
    const sefirah = sefirot.find(item => item.fields.includes(field?.id));
    window.parent.postMessage({
      channel:'magnum-opus-knowledge-bridge', version:1, type:'search-term', query:selectedTerm.term,
      context:{term:selectedTerm.term,sefirah:sefirah?.name||'',field:field?.name||'',category:category?.name||''}
    },window.location.origin);
  });
  const ownField = byFieldId(selectedTerm.fieldId), ownCategory = ownField?.categories.find(category => category.id === selectedTerm.categoryId);
  if (embedded && ownCategory) renderBubbleTools(panel,ownField,ownCategory);
  const ownEntries = ownCategory ? termsFor(ownField,ownCategory) : [];
  const ownIndex = ownEntries[selectedTerm.customIndex]?.term === selectedTerm.term && ownEntries[selectedTerm.customIndex]?.description === selectedTerm.description
    ? selectedTerm.customIndex : ownEntries.findIndex(entry => entry.term === selectedTerm.term && entry.description === selectedTerm.description);
  if (ownIndex >= 0) {
    const edit = document.createElement('button');
    edit.type = 'button'; edit.className = 'overview-link'; edit.textContent = 'Upraviť alebo presunúť vlastný pojem';
    edit.dataset.termEdit = '1';
    edit.disabled = !ready || uploadRunning || editingRunning || storageBusy || externalReloadPending;
    edit.addEventListener('click',() => openTermEditor(ownField.id,ownCategory.id,ownIndex));
    panel.append(edit);
  }
  bindDocumentResults(panel,selectedTerm.term);
  panel.querySelector('#browse-library')?.addEventListener('click',() => document.querySelector('.document-library').scrollIntoView({behavior:'smooth',block:'start'}));
  panel.querySelector('#show-game-matches')?.addEventListener('click',() => document.querySelector('#game-search-results').scrollIntoView({behavior:'smooth',block:'start'}));
  window.MOKnowledgeLearning?.mount(selectedTerm,libraryDocuments);
  renderGrimoireLinks(panel);
  renderReader();
}

function openDocumentMatch(documentId, matchIndex) {
  const docItem = mappedDocuments().find(item => item.id === documentId);
  if (!docItem || !selectedTerm) return;
  if (embedded) {
    void requestGrimoire(docItem.grimoireId ? 'open' : 'open-map',docItem.grimoireId || docItem.mapDocumentId || docItem.id)
      .catch(error => storageMessage(`Dokument sa neotvoril: ${error.message}`));
    return;
  }
  if (docItem.mime === 'application/pdf' || /^image\//.test(docItem.mime)) {
    if (!window.MOKnowledgeReader) return storageMessage('Čítačka sa nepodarila načítať. Obnov túto stránku.');
    window.MOKnowledgeReader.open({mime:docItem.mime,pagination:docItem.mime === 'application/pdf' ? 'pages' : 'unpaginated',pages:docItem.pages,text:docItem.text,title:docItem.name,assetId:null,conceptIds:[],analysisStatus:docItem.analysisStatus || 'indexed'}, {
      query:selectedTerm.term, original:{blob:docItem.blob,name:docItem.name}, concepts:readerConcepts(), onConcept:openConcept,
      onQuery:query => searchInMap(query)
    });
    return;
  }
  const matches = documentMatches(docItem,selectedTerm.term)
    .flatMap(page => page.ranges.map(range => ({page:page.page,range})));
  readerState = {documentId,matchIndex:Math.max(0,Math.min(matchIndex,matches.length-1)),pageIndex:0};
  renderReader();
  document.querySelector('#document-reader').scrollIntoView({behavior:'smooth',block:'nearest'});
}

function renderReader() {
  const reader = document.querySelector('#document-reader');
  if (!readerState || !selectedTerm) {
    reader.hidden = true;
    return;
  }
  const item = libraryDocuments.find(document => document.id === readerState.documentId);
  if (!item) {
    reader.hidden = true;
    return;
  }
  const matches = documentMatches(item,selectedTerm.term).flatMap(page =>
    page.ranges.map(range => ({page:page.page,range}))
  );
  const current = matches[readerState.matchIndex] || {page:readerState.pageIndex || 0};
  const pageText = item.pages[current.page]?.text || '';
  const ranges = findTextRanges(pageText,selectedTerm.term);
  const occurrenceOnPage = matches.slice(0,readerState.matchIndex).filter(match => match.page === current.page).length;
  let marked = '', cursor = 0;
  ranges.forEach((range,index) => {
    marked += escapeHtml(pageText.slice(cursor,range.start));
    marked += `<mark class="${index === occurrenceOnPage ? 'current-hit' : ''}">${escapeHtml(pageText.slice(range.start,range.end))}</mark>`;
    cursor = range.end;
  });
  marked += escapeHtml(pageText.slice(cursor));
  reader.hidden = false;
  document.querySelector('#reader-title').textContent = item.name;
  document.querySelector('#reader-page-label').textContent = item.pageKind === 'original'
    ? `Časť ${item.pages[current.page]?.number || current.page+1} · oddeľovač v texte`
    : `Virtuálna strana ${current.page+1} z ${item.pages.length} · bez pôvodnej paginácie`;
  document.querySelector('#occurrence-count').textContent = matches.length ? `Výskyt ${readerState.matchIndex+1} z ${matches.length}` : (selectedTerm.term ? 'Žiadny výskyt v texte · prezeranie strán' : 'Prezeranie strán');
  document.querySelector('#previous-occurrence').disabled = matches.length ? matches.length < 2 : item.pages.length < 2;
  document.querySelector('#next-occurrence').disabled = matches.length ? matches.length < 2 : item.pages.length < 2;
  document.querySelector('#previous-occurrence').textContent = matches.length ? '← Predchádzajúci výskyt' : '← Predchádzajúca strana';
  document.querySelector('#next-occurrence').textContent = matches.length ? 'Ďalší výskyt →' : 'Ďalšia strana →';
  document.querySelector('#reader-page').innerHTML = marked || '<span class="empty-page">Táto strana neobsahuje čitateľný text.</span>';
  const download = document.querySelector('#download-original');
  if (downloadDocumentId !== item.id) {
    if (downloadURL) URL.revokeObjectURL(downloadURL);
    downloadURL = item.blob instanceof Blob ? URL.createObjectURL(item.blob) : '';
    downloadDocumentId = item.id;
  }
  download.hidden = !downloadURL;
  if (downloadURL) { download.href = downloadURL; download.download = item.name; }
  document.querySelector('.current-hit')?.scrollIntoView({block:'nearest'});
}

function readerConcepts() {
  return fields.flatMap(field => [{id:field.id,parentId:null,name:field.name,keywords:[...field.terms,...field.categories.flatMap(category => termEntriesFor(field,category).map(entry => entry.term))]}, ...field.categories.map(category => ({id:`${field.id}__${category.id}`,parentId:field.id,name:category.name,keywords:termEntriesFor(field,category).map(entry => entry.term)}))]);
}

function openConcept(id, query) {
  const field = byFieldId(id.split('__')[0]);
  if (!field) return;
  selectedField = field.id;
  selectedId = sefirot.find(item => item.fields.includes(field.id))?.id || 'keter';
  if (typeof query === 'string') {
    searchTerm = query.trim().slice(0,200);
    document.querySelector('#search').value = searchTerm;
    selectedTerm = searchTerm ? {term:searchTerm,description:''} : null;
  }
  if (selectedTerm?.fieldId && selectedTerm.fieldId !== field.id) selectedTerm = null;
  const requestedCategory = field.categories.find(category => category.id === id.split('__')[1]);
  const matchingCategory = selectedTerm && (requestedCategory ? [requestedCategory] : field.categories).find(category => termEntriesFor(field,category).some(entry => normalize(entry.term) === normalize(selectedTerm.term)));
  const matchingEntry = matchingCategory && termEntriesFor(field,matchingCategory).find(entry => normalize(entry.term) === normalize(selectedTerm.term));
  if (matchingEntry) selectedTerm = { ...selectedTerm, fieldId:field.id, categoryId:matchingCategory.id, term:matchingEntry.term, description:matchingEntry.description };
  activeView = 'map';
  render();
  if (matchingCategory) window.MOKnowledgeFieldMap?.focusSelection();
  else window.MOKnowledgeFieldMap?.focusCategory(id.split('__')[1]);
  document.querySelector('#field-map-view').scrollIntoView({behavior:'smooth',block:'start'});
}

function searchInMap(query) {
  if (!query || query.length > 200) return;
  searchTerm = query.trim();
  document.querySelector('#search').value = searchTerm;
  selectedTerm = null;
  readerState = null;
  selectedField = '';
  activeView = 'overview';
  render();
}

function renderFieldMap(field) {
  document.querySelector('#map-field-title').textContent = field.name;
  const selectedAuthorCategory = document.querySelector('#manual-author-category').value;
  const selectedTermCategory = document.querySelector('#term-category').value;
  document.querySelector('#field-map-content').innerHTML = field.categories.map((category,categoryIndex) => {
    const authors = authorsFor(field, category);
    const entries = termEntriesFor(field,category);
    return `<article class="subcategory-card">
      <h4>${escapeHtml(category.name)}</h4>
      <div class="concept-term-list">${entries.map((entry,index) => `<div class="concept-term-item"><button type="button" class="concept-term" data-category="${escapeHtml(category.id)}" data-term-index="${index}" style="--term-hue:${(index*53+categoryIndex*37)%360}">
        <span class="term-visual"><span class="term-orbit" aria-hidden="true"></span>${escapeHtml(entry.term)}</span>
        ${entry.description ? `<span class="concept-term-description">${escapeHtml(entry.description)}</span>` : ''}
      </button>${index >= category.terms.length ? `<button type="button" class="quiet-button term-edit-button" data-edit-category="${escapeHtml(category.id)}" data-edit-index="${index-category.terms.length}" aria-label="Upraviť vlastný pojem ${escapeHtml(entry.term)}">Upraviť / presunúť</button>` : ''}</div>`).join('')}</div>
      <p class="authors-label">Autori a myslitelia · orientačný výber</p>
      <div class="author-list">${authors.length
        ? authors.map(name => `<button type="button" class="author-chip" data-author="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join('')
        : '<span class="author-empty">Zatiaľ bez mien</span>'}</div>
    </article>`;
  }).join('');
  document.querySelector('#manual-author-category').innerHTML = field.categories
    .map(category => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`).join('');
  document.querySelector('#term-category').innerHTML = field.categories
    .map(category => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`).join('');
  if (field.categories.some(category => category.id === selectedAuthorCategory)) document.querySelector('#manual-author-category').value = selectedAuthorCategory;
  if (field.categories.some(category => category.id === selectedTermCategory)) document.querySelector('#term-category').value = selectedTermCategory;
  document.querySelector('#author-detection-status').textContent = authorStorageWarning;
  document.querySelector('#term-status').textContent = termStorageWarning;
  document.querySelectorAll('.concept-term').forEach(button => button.addEventListener('click',() => {
    const category = field.categories.find(item => item.id === button.dataset.category);
    const entry = category && termEntriesFor(field,category)[Number(button.dataset.termIndex)];
    if (!entry) return;
    activateFieldTerm(field, category, entry);
  }));
  document.querySelectorAll('[data-author]').forEach(button => button.addEventListener('click',() => {
    selectedTerm = {term:button.dataset.author,description:'Presné meno autora v názvoch a prepisoch lokálnych dokumentov.'};
    readerState = null;
    window.MOKnowledgeFieldMap?.markSelected(null);
    renderTermAssets();
  }));
  document.querySelectorAll('[data-edit-category]').forEach(button => {
    button.disabled = !ready || uploadRunning || editingRunning || storageBusy || externalReloadPending;
    button.addEventListener('click',() => openTermEditor(field.id, button.dataset.editCategory, Number(button.dataset.editIndex)));
  });
  window.MOKnowledgeFieldMap?.render({
    id:field.id, name:field.name,
    categories:field.categories.map(category => ({id:category.id,name:category.name,terms:termEntriesFor(field,category)})),
    selected:selectedTerm?.fieldId === field.id ? selectedTerm : null,
    onTerm(categoryId, index) {
      const category = field.categories.find(item => item.id === categoryId);
      const entry = category && termEntriesFor(field,category)[index];
      if (entry) activateFieldTerm(field, category, entry);
    }
  });
  renderTermAssets();
}

function activateFieldTerm(field, category, entry) {
  selectedTerm = {fieldId:field.id,categoryId:category.id,term:entry.term,description:entry.description,
    customIndex:termsFor(field,category).findIndex(item => entry.serverId ? item.serverId === entry.serverId : item === entry)};
  readerState = null;
  document.querySelector('#term-category').value = category.id;
  window.MOKnowledgeFieldMap?.markSelected(selectedTerm);
  renderTermAssets();
}

async function addCustomTerm(field, category, term, description, parent = null) {
  if (!ready) throw new Error('Úložisko ešte nie je pripravené.');
  if (externalReloadPending) throw new Error('Najprv načítaj uložené zmeny z druhej karty tlačidlom nad mapou.');
  if (editingRunning) throw new Error('Predchádzajúca zmena sa ešte ukladá.');
  if (uploadRunning || storageBusy) throw new Error('Počkaj na dokončenie spracovania alebo zálohy.');
  const normalizedTerm = normalize(term.trim());
  const existsInBuiltIns = category.terms.some(existing => normalize(existing.trim()) === normalizedTerm);
  const existsInCustom = termsFor(field, category).some(existing => normalize(existing.term.trim()) === normalizedTerm);
  if (existsInBuiltIns || existsInCustom) return false;
  if (embedded) {
    const details = {fieldId:field.id,categoryId:category.id,term:term.trim(),description:description.trim(),
      note:'',documentIds:[],folderIds:[],collectionIds:[],parent};
    const fingerprint = JSON.stringify(details);
    if (termCreation?.fingerprint !== fingerprint) termCreation = {fingerprint,key:crypto.randomUUID()};
    editingRunning = true; setBusy(true);
    try {
      const result = await requestTerminology('create',{creationKey:termCreation.key,details});
      acceptTerminology(result.catalog); termCreation = null;
      await refreshGrimoire();
      renderTerminologyWorkspace();
      return result.termId;
    } finally { editingRunning = false; setBusy(false); }
  }

  const expected = customTerms, proposal = structuredClone(expected);
  proposal[field.id] ||= {};
  proposal[field.id][category.id] ||= [];
  proposal[field.id][category.id].push({term:term.trim(), description:description.trim()});
  editingRunning = true;
  setBusy(true);
  try {
    if (!await saveCustomTerms(proposal, expected)) throw new Error(termStorageWarning);
  } finally { editingRunning = false; setBusy(false); if (externalReloadPending) showExternalChange(); }
  return true;
}

function renderBubbleTools(panel,field,category) {
    const current = terminologyCatalog.terms.find(item => item.fieldId === field.id && item.categoryId === category.id && item.term === selectedTerm.term);
    const builtin = category.terms.includes(selectedTerm.term);
    const section = document.createElement('section'); section.className = 'author-tools';
    const heading = document.createElement('h4'); heading.textContent = `Podbublina pod „${selectedTerm.term}“`;
    section.append(heading);
    if (!current && !builtin) {
      const note = document.createElement('p'); note.textContent = 'Tento starší prehliadačový termín nemá identitu účtu. Podbubliny možno pridávať pod pôvodné katalógové bubliny a nové vlastné bubliny; staré dáta zostávajú zachované.';
      section.append(note); panel.append(section); return;
    }
    const form = document.createElement('form'); form.dataset.bubbleCreate = '1';
    const name = document.createElement('input'); name.required = true; name.maxLength = 150; name.setAttribute('aria-label','Terminológia novej podbubliny'); name.placeholder = 'Terminológia novej podbubliny';
    const description = document.createElement('textarea'); description.required = true; description.maxLength = 2000;
    description.setAttribute('aria-label','Popis novej podbubliny'); description.placeholder = 'Popis terminológie';
    const files = document.createElement('input'); files.type = 'file'; files.multiple = true; files.setAttribute('aria-label','Súbory novej podbubliny');
    files.accept = document.querySelector('#document-upload').accept;
    const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'Pridať podbublinu';
    const status = document.createElement('p'); status.setAttribute('role','status');
    form.append(name,description,files,submit,status);
    const draftKey = current?.id || `${field.id}/${category.id}/${selectedTerm.term}`;
    const draft = bubbleDrafts.get(draftKey);
    if (draft) { name.value = draft.name; description.value = draft.description; }
    form.addEventListener('input',() => bubbleDrafts.set(draftKey,{name:name.value,description:description.value}));
    form.addEventListener('submit',async event => {
      event.preventDefault(); submit.disabled = true;
      try {
        const id = await addCustomTerm(field,category,name.value,description.value,current ? {termId:current.id} : {term:selectedTerm.term});
        if (!id) throw new Error('Takto pomenovaný termín už v tejto vetve existuje.');
        bubbleDrafts.delete(draftKey);
        const entry = terminologyCatalog.terms.find(item => item.id === id);
        if (entry) selectedTerm = {...entry,customIndex:-1};
        render(); window.MOKnowledgeFieldMap?.focusSelection();
        if (files.files.length) await uploadDocuments(files,id);
        storageMessage('Podbublina je uložená. Nahrané súbory nájdeš aj vo vnorených priečinkoch Grimoára; bez súboru sa priečinok nevytvára.');
      } catch (error) { status.textContent = error.message; storageMessage(error.message); }
      finally { submit.disabled = false; }
    });
    section.append(form);
    if (current) {
      const upload = document.createElement('input'); upload.type = 'file'; upload.multiple = true;
      upload.accept = files.accept; upload.setAttribute('aria-label',`Nahrať súbory do bubliny ${current.term}`);
      const label = document.createElement('label'); label.textContent = 'Nahrať ďalšie súbory do tejto bubliny'; label.append(upload);
      upload.addEventListener('change',() => { void uploadDocuments(upload,current.id).catch(error => storageMessage(error.message)); });
      section.append(label);
    }
    panel.append(section);
  }
function editorCategories(fieldId, categoryId) {
  const field = byFieldId(fieldId), select = document.querySelector('#term-edit-category');
  select.innerHTML = (field?.categories || []).map(category => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`).join('');
  if (field?.categories.some(category => category.id === categoryId)) select.value = categoryId;
}

function openTermEditor(fieldId, categoryId, index) {
  if (!ready || uploadRunning || editingRunning || storageBusy || externalReloadPending) return;
  const field = byFieldId(fieldId), category = field?.categories.find(item => item.id === categoryId);
  const entry = category && termsFor(field,category)[index];
  if (!entry) return;
  termEdit = {fieldId,categoryId,index,original:{...entry},snapshot:customTerms,
    serverTerm:entry.serverId ? terminologyCatalog.terms.find(item => item.id === entry.serverId) : null};
  document.querySelector('#term-edit-origin').textContent = `${field.name} → ${category.name}`;
  document.querySelector('#term-edit-field').innerHTML = fields.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
  document.querySelector('#term-edit-field').value = fieldId;
  editorCategories(fieldId, categoryId);
  document.querySelector('#term-edit-name').value = entry.term;
  document.querySelector('#term-edit-description').value = entry.description;
  document.querySelector('#term-edit-status').textContent = '';
  document.querySelector('#term-edit-dialog').showModal();
}

document.querySelector('#term-edit-field').addEventListener('change',event => editorCategories(event.target.value));
document.querySelector('#term-edit-cancel').addEventListener('click',() => { if (!editingRunning) document.querySelector('#term-edit-dialog').close(); });
document.querySelector('#term-edit-dialog').addEventListener('cancel',event => { if (editingRunning) event.preventDefault(); });
document.querySelector('#term-edit-dialog').addEventListener('close',() => { termEdit = null; });
document.querySelector('#term-edit-form').addEventListener('submit',async event => {
  event.preventDefault();
  const status = document.querySelector('#term-edit-status');
  if (!termEdit || !ready || uploadRunning || editingRunning || storageBusy || externalReloadPending) {
    status.textContent = 'Úpravu teraz nemožno uložiť. Ak sa údaje zmenili v druhej karte, najprv zavri editor a načítaj uložené zmeny. Rozpísané hodnoty sú stále tu.';
    return;
  }
  const edit = termEdit;
  const field = byFieldId(document.querySelector('#term-edit-field').value);
  const category = field?.categories.find(item => item.id === document.querySelector('#term-edit-category').value);
  const term = document.querySelector('#term-edit-name').value.trim();
  const description = document.querySelector('#term-edit-description').value.trim();
  if (!field || !category || !term || term.length > 150 || description.length > 2000) { status.textContent = 'Vyber vetvu a vyplň názov pojmu (najviac 150 znakov) a voliteľný popis (najviac 2 000 znakov).'; return; }
  if (edit.serverTerm) {
    editingRunning = true; setBusy(true);
    try {
      const result = await requestTerminology('save',{id:edit.serverTerm.id,expectedRevision:edit.serverTerm.revision,
        details:{...termDetails(edit.serverTerm),fieldId:field.id,categoryId:category.id,term,description}});
      acceptTerminology(result.catalog);
      selectedTerm = {fieldId:field.id,categoryId:category.id,term,description,customIndex:-1};
      selectedField = field.id; selectedId = sefirot.find(item => item.fields.includes(field.id))?.id || 'keter';
      document.querySelector('#term-edit-dialog').close();
      await refreshGrimoire(); render(); renderTerminologyWorkspace();
    } catch (error) { status.textContent = error.message; }
    finally { editingRunning = false; setBusy(false); }
    return;
  }
  const proposal = structuredClone(edit.snapshot), source = proposal[edit.fieldId]?.[edit.categoryId];
  const original = source?.[edit.index];
  if (!original || original.term !== edit.original.term || original.description !== edit.original.description) { status.textContent = 'Pôvodný pojem sa zmenil. Zavri editor, načítaj uložené zmeny a otvor ho znova.'; return; }
  source.splice(edit.index,1);
  proposal[field.id] ||= {};
  const target = proposal[field.id][category.id] ||= [];
  const normalized = normalize(term);
  if (category.terms.some(item => normalize(item.trim()) === normalized) || target.some(item => normalize(item.term.trim()) === normalized)) { status.textContent = 'V cieľovej vetve už je pojem s rovnakým názvom. Vyber inú vetvu alebo názov. Pôvodný pojem zostal zachovaný.'; return; }
  const sameBranch = field.id === edit.fieldId && category.id === edit.categoryId;
  const index = sameBranch ? edit.index : target.length;
  target.splice(index,0,{term,description});
  editingRunning = true; setBusy(true);
  let saved = false;
  try {
    saved = await saveCustomTerms(proposal,edit.snapshot);
    if (!saved) { status.textContent = termStorageWarning; return; }
    selectedField = field.id;
    selectedId = sefirot.find(item => item.fields.includes(field.id))?.id || 'keter';
    selectedTerm = {fieldId:field.id,categoryId:category.id,term,description,customIndex:index};
    searchTerm = ''; document.querySelector('#search').value = '';
    readerState = null; activeView = 'map';
    render();
    document.querySelector('#term-category').value = category.id;
    window.MOKnowledgeFieldMap?.focusSelection();
    document.querySelector('#term-status').textContent = 'Pojem bol upravený a uložený v zvolenej vetve.';
  } finally {
    editingRunning = false; setBusy(false);
    if (externalReloadPending) showExternalChange();
    if (saved) document.querySelector('#term-edit-dialog').close();
  }
});

async function addCustomAuthor(field, category, name) {
  if (!ready) throw new Error('Úložisko ešte nie je pripravené.');
  if (externalReloadPending) throw new Error('Najprv načítaj uložené zmeny z druhej karty tlačidlom nad mapou.');
  if (editingRunning) throw new Error('Predchádzajúca zmena sa ešte ukladá.');
  if (uploadRunning || storageBusy) throw new Error('Počkaj na dokončenie spracovania alebo zálohy.');
  const normalizedName = normalize(name.trim());
  const existingNames = authorsFor(field, category);
  if (existingNames.some(existing => normalize(existing.trim()) === normalizedName)) return false;
  const expected = customAuthors, proposal = structuredClone(expected);
  proposal[field.id] ||= {};
  proposal[field.id][category.id] ||= [];
  proposal[field.id][category.id].push(name.trim());
  editingRunning = true;
  setBusy(true);
  try {
    if (!await saveCustomAuthors(proposal, expected)) throw new Error(authorStorageWarning);
  } finally { editingRunning = false; setBusy(false); if (externalReloadPending) showExternalChange(); }
  return true;
}

function textContainsName(text, name) {
  const normalizedText = ` ${normalize(text).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
  const normalizedName = ` ${normalize(name).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
  return normalizedName.length > 2 && normalizedText.includes(normalizedName);
}

function drawTree() {
  const pathLayer = document.querySelector('#paths'), nodeLayer = document.querySelector('#nodes');
  pathLayer.innerHTML = paths.map(([a,b]) => `<line class="path" data-from="${a}" data-to="${b}" x1="${positions[a][0]}" y1="${positions[a][1]}" x2="${positions[b][0]}" y2="${positions[b][1]}"/>`).join('');
  nodeLayer.innerHTML = sefirot.map((item,index) => {
    const [x,y] = positions[index];
    return `<g class="tree-node" data-id="${item.id}" role="button" tabindex="0" aria-label="${item.name}, ${item.translation}; ${item.bridge}"><circle cx="${x}" cy="${y}" r="45"/><text class="node-title" x="${x}" y="${y-5}">${item.name}</text><text class="node-caption" x="${x}" y="${y+13}">${item.translation}</text></g>`;
  }).join('');
  nodeLayer.querySelectorAll('.tree-node').forEach(node => {
    node.addEventListener('click', () => selectSefirah(node.dataset.id));
    node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectSefirah(node.dataset.id); } });
  });
}

function drawCatalog() {
  const catalog = document.querySelector('#catalog');
  catalog.innerHTML = fields.map(field => `<button type="button" class="science-card" data-field="${field.id}"><span class="science-card-top"><span class="field-name">${field.name}</span><span class="sefira-ref">${field.ref}</span></span><span class="field-description">${field.description}</span><span class="term-list">${field.terms.map(term => `<span class="term">${term}</span>`).join('')}</span></button>`).join('');
  catalog.querySelectorAll('.science-card').forEach(card => card.addEventListener('click', () => {
    const field = byFieldId(card.dataset.field);
    const matchedSefirah = sefirot.find(item => item.fields.includes(field.id));
    selectedField = field.id;
    selectedTerm = null;
    readerState = null;
    if (matchedSefirah) selectedId = matchedSefirah.id;
    activeView = 'bridge';
    render();
    document.querySelector('.detail-panel').scrollIntoView({behavior:'smooth',block:'nearest'});
  }));
}

function selectSefirah(id) { selectedId = id; selectedField = ''; selectedTerm = null; readerState = null; activeView = 'bridge'; render(); }
function matchesSearch(text) { return !searchTerm || findTextRanges(text,searchTerm).length > 0; }

function render() {
  if (!selectedField && activeView === 'map') activeView = 'bridge';
  const item = bySefirahId(selectedId) || sefirot[0], index = sefirot.indexOf(item);
  const visibleFields = item.fields.map(byFieldId).filter(Boolean);
  document.querySelector('#detail-index').textContent = `${String(index+1).padStart(2,'0')} / 10`;
  document.querySelector('#pillar').textContent = item.pillar.toLocaleUpperCase('sk');
  document.querySelector('#detail-title').textContent = item.name;
  document.querySelector('#detail-translation').textContent = item.translation;
  document.querySelector('#detail-meaning').textContent = item.meaning;
  const bridgeField = selectedField ? byFieldId(selectedField) : null;
  document.querySelector('#detail-bridge').textContent = bridgeField ? bridgeField.name : item.bridge;
  document.querySelector('#bridge-explanation').textContent = bridgeField
    ? `${bridgeField.description} Pojmy: ${bridgeField.terms.join(' · ')}`
    : `Táto súvislosť je interpretačná pomôcka na orientáciu. ${item.bridge}`;
  document.querySelector('#detail-relation').textContent = item.relation;
  document.querySelector('#open-field-map').hidden = !bridgeField;
  document.querySelector('#field-list').innerHTML = visibleFields.map(field => `<button type="button" class="field-card ${selectedField === field.id ? 'active' : ''}" data-field="${field.id}"><span>${field.name}</span><small>${catalogTermsFor(field).length} pojmov</small></button>`).join('');
  document.querySelectorAll('.field-card').forEach(card => card.addEventListener('click', () => {
    selectedField = card.dataset.field;
    selectedTerm = null;
    readerState = null;
    activeView = 'bridge';
    render();
  }));
  document.querySelector('#bridge-tab').setAttribute('aria-selected', String(activeView === 'bridge'));
  document.querySelector('#overview-tab').setAttribute('aria-selected', String(activeView === 'overview'));
  document.querySelector('#field-map-tab').hidden = !bridgeField;
  document.querySelector('#field-map-tab').setAttribute('aria-selected', String(activeView === 'map'));
  document.querySelector('.view-switch').classList.toggle('has-map', Boolean(bridgeField));
  document.querySelector('#bridge-view').hidden = activeView !== 'bridge';
  document.querySelector('#overview-view').hidden = activeView !== 'overview';
  document.querySelector('#field-map-view').hidden = activeView !== 'map';
  document.querySelector('.workspace').classList.toggle('has-field-map', activeView === 'map');
  document.querySelector('#catalog-section').hidden = activeView !== 'overview';
  if (bridgeField) renderFieldMap(bridgeField);

  document.querySelectorAll('.tree-node').forEach((node,i) => {
    const active = sefirot[i].id === selectedId;
    const related = sefirot[i].fields.some(id => {
      const field = byFieldId(id);
      return field && matchesSearch(fieldSearchText(field));
    });
    node.classList.toggle('selected',active);
    node.classList.toggle('dimmed',!!searchTerm && !matchesSearch(`${sefirot[i].name} ${sefirot[i].translation} ${sefirot[i].bridge}`) && !related);
  });
  document.querySelectorAll('.path').forEach(path => {
    const from = sefirot[Number(path.dataset.from)], to = sefirot[Number(path.dataset.to)];
    path.classList.toggle('active',from.id === selectedId || to.id === selectedId);
  });
  let shown = 0;
  document.querySelectorAll('.science-card').forEach(card => {
    const field = byFieldId(card.dataset.field);
    const terms = catalogTermsFor(field);
    card.querySelector('.term-list').innerHTML = terms.map(term => `<span class="term">${escapeHtml(term)}</span>`).join('');
    const visible = matchesSearch(fieldSearchText(field)) && (!selectedField || selectedField === field.id);
    card.classList.toggle('hidden',!visible);
    card.classList.toggle('active',selectedField === field.id);
    card.querySelectorAll('.term').forEach(term => term.classList.toggle('match',!!searchTerm && matchesSearch(term.textContent)));
    if (visible) shown++;
  });
  document.querySelector('#no-results').hidden = shown > 0;
  document.querySelector('#result-count').textContent = searchTerm ? `${shown} zhôd` : '6 hlavných polí + priečne vrstvy';
  renderGlobalResults();
  renderReader();
}

drawTree();
drawCatalog();
render();
renderDocumentLibrary();
// A text reader also serves words that have no curated field yet.
document.querySelector('#game-search-results').after(document.querySelector('#document-reader'));
document.querySelector('#document-reader').classList.add('standalone-reader');
document.querySelector('#reader-page').addEventListener('dblclick',() => {
  const word = String(window.getSelection() || '').trim();
  if (word && word.length <= 200) searchInMap(word);
});
initialize();
document.querySelector('#close-text-reader').addEventListener('click',() => { readerState = null; renderReader(); });
window.addEventListener('pagehide',() => {
  cancelGameSearch();
  if (downloadURL) URL.revokeObjectURL(downloadURL);
  window.MOKnowledgeExtract?.cancel();
  window.MOKnowledgeReader?.destroy();
});

document.querySelector('#search').addEventListener('input',event => { searchTerm = event.target.value.trim(); selectedField = ''; selectedTerm = null; readerState = null; if (searchTerm) activeView = 'overview'; render(); });
document.querySelector('#bridge-tab').addEventListener('click',() => { activeView = 'bridge'; render(); });
document.querySelector('#overview-tab').addEventListener('click',() => { activeView = 'overview'; render(); });
document.querySelector('#show-overview').addEventListener('click',() => {
  activeView = 'overview';
  render();
  document.querySelector('#catalog-section').scrollIntoView({behavior:'smooth',block:'start'});
});
document.querySelector('#show-bridge').addEventListener('click',() => { activeView = 'bridge'; render(); });
document.querySelector('#field-map-tab').addEventListener('click',() => {
  if (!selectedField) return;
  activeView = 'map';
  render();
});
document.querySelector('#open-field-map').addEventListener('click',() => {
  if (!selectedField) return;
  activeView = 'map';
  render();
});
document.querySelector('#field-map-back').addEventListener('click',() => { activeView = 'bridge'; render(); });
document.querySelector('#manual-author-form').addEventListener('submit',async event => {
  event.preventDefault();
  const field = byFieldId(selectedField);
  const category = field?.categories.find(item => item.id === document.querySelector('#manual-author-category').value);
  const input = document.querySelector('#manual-author-name');
  const name = input.value.trim();
  const status = document.querySelector('#author-detection-status');
  if (!field || !category || !name) {
    status.textContent = 'Vyber platnú podkategóriu a zadaj meno autora.';
    return;
  }
  let added;
  try { added = await addCustomAuthor(field, category, name); }
  catch (error) { status.textContent = error.message; return; }
  input.value = '';
  render();
  status.textContent = added
    ? authorStorageWarning || `Ručne pridaný autor: ${name}.`
    : `Meno ${name} už v tejto podkategórii je.`;
});
document.querySelector('#detect-authors').addEventListener('click',async () => {
  const field = byFieldId(selectedField);
  const text = document.querySelector('#author-text').value;
  const status = document.querySelector('#author-detection-status');
  if (!field || !text.trim()) {
    status.textContent = 'Najprv vlož text, v ktorom sa majú mená hľadať.';
    return;
  }
  const recognized = [];
  field.categories.forEach(category => {
    [...authorsFor(field, category), ...(category.recognize || [])].forEach(name => {
      if (textContainsName(text, name)) recognized.push({name, category});
    });
  });
  if (!recognized.length) {
    status.textContent = 'V texte sa nenašlo celé meno zo známeho lokálneho zoznamu tohto odboru.';
    return;
  }
  const names = [...new Set(recognized.map(item => item.name))];
  const added = [];
  try {
    for (const {name, category} of recognized) {
      if (await addCustomAuthor(field, category, name)) added.push(name);
    }
  } catch (error) { render(); status.textContent = error.message; return; }
  render();
  const categories = [...new Set(recognized.map(item => item.category.name))].join(', ');
  status.textContent = `${authorStorageWarning ? `${authorStorageWarning} ` : ''}Rozpoznané mená: ${names.join(', ')}. Podkategórie: ${categories}.${added.length ? ` Automaticky pridané: ${[...new Set(added)].join(', ')}.` : ' Tieto mená už v mape sú.'}`;
});
document.querySelector('#custom-term-form').addEventListener('submit',async event => {
  event.preventDefault();
  const field = byFieldId(selectedField);
  const category = field?.categories.find(item => item.id === document.querySelector('#term-category').value);
  const termInput = document.querySelector('#custom-term-name');
  const descriptionInput = document.querySelector('#custom-term-description');
  const status = document.querySelector('#term-status');
  const term = termInput.value.trim();
  const description = descriptionInput.value.trim();
  if (!field || !category || !term || !description) {
    status.textContent = 'Vyber platnú podkategóriu a vyplň termín aj jeho popis.';
    return;
  }
  let added;
  try { added = await addCustomTerm(field, category, term, description); }
  catch (error) { status.textContent = error.message; return; }
  if (!added) {
    status.textContent = `Termín „${term}“ už v tejto podkategórii existuje.`;
    return;
  }
  termInput.value = '';
  descriptionInput.value = '';
  render();
  status.textContent = `${termStorageWarning ? `${termStorageWarning} ` : ''}Termín „${term}“ bol pridaný do podkategórie ${category.name}.`;
});
async function uploadDocuments(input, termId = null) {
  if (uploadRunning || !ready) {
    if (termId) throw new Error('Počkaj na dokončenie nahrávania a pripravenie úložiska; potom vyber súbory znova.');
    input.value = ''; return;
  }
  const files = [...input.files];
  if (termId && files.length > 100) throw new Error('Do jednej bubliny nahraj najviac 100 súborov naraz.');
  const added = [], rejected = [], addedIds = [];
  uploadRunning = true;
  uploadCancelled = false;
  setBusy(true);
  document.querySelector('#cancel-upload').hidden = false;
  try {
    for (const file of files) {
      if (uploadCancelled) break;
      try {
        const extension = file.name.split('.').pop().toLowerCase();
        const mimes = {txt:'text/plain',md:'text/markdown',markdown:'text/markdown',csv:'text/csv',log:'text/plain',pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'};
        const mime = mimes[extension];
        if (!mime) throw new Error('Nepodporovaný formát.');
        if (file.size > MAX_FILE_BYTES) throw new Error('Súbor presahuje 15 MiB.');
        const bytes = await file.arrayBuffer();
        if (uploadCancelled) break;
        const fingerprint = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte => byte.toString(16).padStart(2,'0')).join('');
        const id = `document-${fingerprint}`;
        if (libraryDocuments.some(item => item.id === id)) {
          if (termId) { addedIds.push(id); added.push(`${file.name} (existujúci originál)`); continue; }
          rejected.push(`${file.name}: tento originál už je uložený`);
          continue;
        }
        let extracted;
        if (['txt','md','markdown','csv','log'].includes(extension)) {
          let text = await file.text(), warning = '';
          if (text.length > 200000) {
            text = text.slice(0,200000);
            if (/^[\uD800-\uDBFF]$/.test(text.slice(-1))) text = text.slice(0,-1);
            warning = 'Prepis je skrátený na 200 000 znakov; celý originál zostáva uložený.';
          }
          if (/[\u0000-\u0008\u000b\u000e-\u001f]/.test(text)) throw new Error('Súbor obsahuje neplatné textové znaky.');
          if (!text.trim()) warning = 'Súbor neobsahuje čitateľný text; originál je uložený.';
          extracted = {text,mime,warning,status:warning ? 'needs_text' : 'indexed'};
        } else {
          if (!window.MOKnowledgeExtract) throw new Error('Lokálne čítanie súborov sa nenačítalo. Obnov stránku.');
          extracted = await window.MOKnowledgeExtract.extract(file,message => {
            document.querySelector('#upload-status').textContent = `${file.name}: ${message}`;
          });
        }
        if (uploadCancelled) break;
        const split = mime === 'application/pdf' ? {pageKind:'original',pages:extracted.pages} : pagesForText(extracted.text);
        const documentEntry = {id,name:file.name,size:file.size,mime,text:extracted.text,pageKind:split.pageKind,pages:split.pages,pagination:mime === 'application/pdf' ? 'pages' : 'unpaginated',analysisStatus:extracted.status,warning:extracted.warning || '',blob:file.slice(0,file.size,mime)};
        const saved = await store.putDocument(documentEntry);
        libraryDocuments.push(saved);
        addedIds.push(saved.id);
        added.push(`${file.name}${extracted.warning ? ` (${extracted.warning})` : ''}`);
        renderDocumentLibrary();
        renderTermAssets();
      } catch (error) {
        if (uploadCancelled || error.name === 'AbortError') break;
        rejected.push(`${file.name}: ${error.message || 'Súbor sa nepodarilo uložiť.'}`);
      }
    }
  } finally {
    uploadRunning = false;
    setBusy(false);
    document.querySelector('#cancel-upload').hidden = true;
    input.value = '';
    renderDocumentLibrary();
    window.MOKnowledgeLearning?.refresh();
    if (externalReloadPending) showExternalChange();
    document.querySelector('#upload-status').textContent = [
      added.length ? `Uložené: ${added.join('; ')}.` : '',
      rejected.length ? `Nevložené: ${rejected.join('; ')}.` : '',
      uploadCancelled ? 'Ďalšie spracovanie bolo zrušené. Už uložené súbory zostali zachované.' : ''
    ].filter(Boolean).join(' ');
    if (embedded && added.length) {
      try {
        await refreshGrimoire();
        if (termId && addedIds.length) {
          acceptTerminology(await requestTerminology('term-folder',{id:termId,mapDocumentIds:addedIds}));
          const term = terminologyCatalog.terms.find(item => item.id === termId);
          if (!term) throw new Error('Uložená bublina nie je dostupná.');
          const documentIds = terminologyCatalog.documents.filter(item => addedIds.includes(item.mapDocumentId)).map(item => item.id);
          const result = await requestTerminology('save',{id:termId,expectedRevision:term.revision,
            details:{...termDetails(term),documentIds:[...new Set([...term.documentIds,...documentIds])]}});
          acceptTerminology(result.catalog);
          await refreshGrimoire(); render();
        }
      } catch (error) {
        const message = `Originály sú uložené v mape, ale priradenie do Grimoára sa nepotvrdilo: ${error.message} Vyber rovnaké súbory pri tejto bubline znova; originály sa neduplikujú.`;
        storageMessage(message);
        if (termId) throw new Error(message);
      }
    }
    if (termId && rejected.length) throw new Error(`Bublina zostáva uložená. Niektoré súbory sa nenahrali: ${rejected.join('; ')}`);
  }
}
document.querySelector('#document-upload').addEventListener('change',event => {
  void uploadDocuments(event.currentTarget).catch(error => storageMessage(error.message));
});
document.querySelector('#previous-occurrence').addEventListener('click',() => {
  if (!readerState) return;
  const item = libraryDocuments.find(document => document.id === readerState.documentId);
  const count = item ? documentMatches(item,selectedTerm.term).reduce((sum,page)=>sum+page.ranges.length,0) : 0;
  if (count) {
    readerState.matchIndex = (readerState.matchIndex - 1 + count) % count;
    renderReader();
  } else if (item) {
    readerState.pageIndex = (readerState.pageIndex - 1 + item.pages.length) % item.pages.length;
    renderReader();
  }
});
document.querySelector('#next-occurrence').addEventListener('click',() => {
  if (!readerState) return;
  const item = libraryDocuments.find(document => document.id === readerState.documentId);
  const count = item ? documentMatches(item,selectedTerm.term).reduce((sum,page)=>sum+page.ranges.length,0) : 0;
  if (count) {
    readerState.matchIndex = (readerState.matchIndex + 1) % count;
    renderReader();
  } else if (item) {
    readerState.pageIndex = (readerState.pageIndex + 1) % item.pages.length;
    renderReader();
  }
});
document.querySelector('#reset').addEventListener('click',() => {
  window.MOKnowledgeViewport?.reset();
  selectedId = 'keter'; selectedField = ''; selectedTerm = null; readerState = null; searchTerm = ''; activeView = 'bridge';
  document.querySelector('#search').value = '';
  render();
});
document.addEventListener('keydown',event => {
  if (event.key === '/' && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault(); document.querySelector('#search').focus(); }
  if (event.key === 'Escape' && document.activeElement.id === 'search') { document.querySelector('#search').value = ''; searchTerm = ''; selectedTerm = null; readerState = null; selectedField = ''; activeView = 'bridge'; render(); }
});

function storageMessage(message) {
  document.querySelector('#storage-status').textContent = message;
  document.querySelector('#storage-status').classList.toggle('storage-error',!ready);
}

function setBusy(busy) {
  const disabled = busy || !ready || editingRunning || storageBusy || externalReloadPending;
  document.querySelectorAll('#document-upload,#export-backup,#import-backup,#custom-term-form button,#manual-author-form button,#detect-authors,[data-edit-category],[data-term-edit],#term-edit-save').forEach(control => { control.disabled = disabled; });
  document.querySelectorAll('#term-edit-dialog input,#term-edit-dialog select,#term-edit-dialog textarea,#term-edit-cancel').forEach(control => { control.disabled = busy || editingRunning || storageBusy; });
  document.querySelectorAll('.backup-control,.upload-control').forEach(control => control.classList.toggle('disabled',disabled));
}

async function initialize() {
  if (editingRunning || uploadRunning || storageBusy) return;
  ready = false;
  setBusy(true);
  try {
    if (!store) throw new Error('Samostatné úložisko sa nenačítalo. Obnov túto stránku.');
    await Promise.all([loadCustomAuthors(),loadCustomTerms(),loadDocuments()]);
    ready = true;
    storageMessage('Samostatné lokálne úložisko je pripravené. Dokumenty sa nikam neodosielajú.');
    render();
    renderDocumentLibrary();
    if (embedded) {
      try { await refreshGrimoire(); }
      catch (error) { storageMessage(`Mapa je dostupná, ale prepojenie Grimoára zlyhalo: ${error.message}`); }
      window.parent.postMessage({channel:'magnum-opus-knowledge-bridge',version:2,type:'map-ready'},window.location.origin);
    }
  } catch (error) {
    ready = false;
    storageMessage(`Úložisko nie je dostupné: ${error.message || 'Prehliadač odmietol prístup.'} Pridávanie je pozastavené; obnov stránku alebo povoľ miestne úložisko.`);
  } finally { setBusy(false); }
}

document.querySelector('#cancel-upload').addEventListener('click',async () => {
  uploadCancelled = true;
  document.querySelector('#cancel-upload').disabled = true;
  try { await window.MOKnowledgeExtract?.cancel(); }
  finally { document.querySelector('#cancel-upload').disabled = false; }
});

document.querySelector('#export-backup').addEventListener('click',async () => {
  if (!ready || uploadRunning || editingRunning || storageBusy) return;
  const status = document.querySelector('#backup-status');
  storageBusy = true;
  setBusy(true);
  try {
    status.textContent = 'Pripravujem zálohu originálov, textov, pojmov a autorov…';
    const blob = await store.exportBackup();
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url;
    link.download = `mapa-poznania-${new Date().toISOString().slice(0,10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url),30000);
    status.textContent = 'Záloha je pripravená na stiahnutie. Uchovaj ju na bezpečnom mieste; obsahuje tvoje dokumenty a originály.';
  } catch (error) { status.textContent = `Zálohu sa nepodarilo vytvoriť: ${error.message}`; }
  finally { storageBusy = false; setBusy(false); if (externalReloadPending) showExternalChange(); }
});

document.querySelector('#import-backup').addEventListener('change',async event => {
  const input = event.currentTarget, file = input.files[0];
  if (!file || !ready || uploadRunning || editingRunning || storageBusy) { input.value = ''; return; }
  const status = document.querySelector('#backup-status');
  storageBusy = true;
  setBusy(true);
  try {
    status.textContent = 'Kontrolujem a pridávam obsah zálohy. Existujúce dokumenty a úpravy zostávajú zachované…';
    const result = await store.importBackup(file);
    await Promise.all([loadCustomAuthors(),loadCustomTerms(),loadDocuments()]);
    render();
    renderDocumentLibrary();
    const countEntries = value => Object.values(value || {}).reduce((total,categories) => total + Object.values(categories || {}).reduce((sum,entries) => sum + (Array.isArray(entries) ? entries.length : 0),0),0);
    status.textContent = `Záloha bola pridaná bez nahradenia existujúcej knižnice. Nové dokumenty: ${result.imported}; celkom dokumentov: ${result.documents}; vlastné pojmy: ${countEntries(result.terms)}; autori: ${countEntries(result.authors)}.`;
  } catch (error) { status.textContent = `Záloha nebola pridaná: ${error.message}`; }
  finally { storageBusy = false; input.value = ''; setBusy(false); if (externalReloadPending) showExternalChange(); }
});

function showExternalChange() {
  externalReloadPending = true;
  if (document.querySelector('#term-edit-dialog').open) document.querySelector('#term-edit-status').textContent = 'Pojmy sa zmenili v druhej karte. Rozpísaná úprava zostáva tu; pred uložením zavri editor, načítaj uložené zmeny a otvor pojem znova.';
  const panel = document.querySelector('#storage-status');
  panel.replaceChildren(document.createTextNode('Knižnica sa zmenila v druhej karte. '));
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'quiet-button';
  button.textContent = 'Načítať uložené zmeny';
  button.addEventListener('click', async () => {
    if (uploadRunning || editingRunning || storageBusy) return;
    externalReloadPending = false;
    await initialize();
  });
  panel.append(button);
  setBusy(false);
}

if (store?.onChanged) store.onChanged(change => {
  if (!change.external) return;
  externalReloadPending = true;
  if (!uploadRunning && !editingRunning) showExternalChange();
});

})();
