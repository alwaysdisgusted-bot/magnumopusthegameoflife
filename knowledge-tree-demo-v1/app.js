'use strict';

const sefirot = [
  { id:'keter', name:'Keter', translation:'Koruna', pillar:'Stredný pilier', meaning:'Najvyššia a skrytá sféra; v mnohých výkladoch vôľa alebo transcendentný potenciál.', relation:'Vrchol hornej triády. V tejto navigačnej vrstve je miestom otázok o tom, čo a ako možno poznať.', bridge:'Filozofia vedy a epistemológia', fields:['philosophy-of-science'] },
  { id:'chokhmah', name:'Chokhmah', translation:'Múdrosť', pillar:'Pravý pilier', meaning:'Prvotný záblesk tvorivej intuície alebo vhľadu.', relation:'Pravý pól hornej triády; vo vzťahu k Binah predstavuje prvotný vhľad oproti rozvinutému uchopeniu.', bridge:'Prírodné vedy — otázky, hypotézy a modely; intuícia sama osebe nie je dôkaz.', fields:['natural-sciences'] },
  { id:'binah', name:'Binah', translation:'Porozumenie', pillar:'Ľavý pilier', meaning:'Rozvinutie, rozlišovanie a uchopenie prvotného vhľadu.', relation:'Ľavý pól hornej triády, tradične uvádzaný vo vzťahu s Chokhmah.', bridge:'Metódy a formálne nástroje: matematika, logika, štatistika a dizajn výskumu.', fields:['research-methods'] },
  { id:'chesed', name:'Chesed', translation:'Láskavosť', pillar:'Pravý pilier', meaning:'Rozširujúca sa štedrosť, milosrdenstvo alebo láskavá priazeň.', relation:'Pravý pól strednej triády; v schéme je v napätí a rovnováhe s Gevurah.', bridge:'Lekárske a zdravotnícke vedy — starostlivosť o zdravie a život.', fields:['medical-health-sciences'] },
  { id:'gevurah', name:'Gevurah', translation:'Sila / prísnosť', pillar:'Ľavý pilier', meaning:'Obmedzenie, disciplína a súd; v napätí a rovnováhe s Chesed.', relation:'Ľavý pól strednej triády; dvojicu expanzie a obmedzenia sprostredkuje Tiferet.', bridge:'Etika výskumu, kontrola skreslení a reprodukovateľnosť — priečne zásady.', fields:['research-governance'] },
  { id:'tiferet', name:'Tiferet', translation:'Krása', pillar:'Stredný pilier', meaning:'Harmónia a rovnováha; v mnohých výkladoch sprostredkuje medzi Chesed a Gevurah.', relation:'Stredný uzol strednej triády. Tu slúži ako interpretačný uzol pre vzťahy medzi odbormi.', bridge:'Spoločenské vedy a interdisciplinarita — syntéza perspektív; napr. psychológia → kognícia.', fields:['social-sciences','interdisciplinary-science'] },
  { id:'netzach', name:'Netzach', translation:'Trvanie / víťazstvo', pillar:'Pravý pilier', meaning:'Vytrvalosť a pretrvanie; preklady a dôrazy sa líšia podľa výkladu.', relation:'Pravý pól dolnej dvojice Netzach–Hod; schematické diagramy prepájajú dolnú časť stromu viacerými cestami.', bridge:'Inžinierstvo a technológie — navrhovanie a uskutočňovanie riešení.', fields:['engineering-technology'] },
  { id:'hod', name:'Hod', translation:'Vznešenosť / sláva', pillar:'Ľavý pilier', meaning:'Vznešenosť a uznanie; často sa uvádza v páre s Netzach.', relation:'Ľavý pól dolnej dvojice Netzach–Hod.', bridge:'Humanitné vedy — historická, jazyková, filozofická a interpretačná práca.', fields:['humanities'] },
  { id:'yesod', name:'Yesod', translation:'Základ', pillar:'Stredný pilier', meaning:'Základ a sprostredkujúce spojenie s Malkhut.', relation:'Sprostredkujúci uzol dolnej časti stromu; symbolicky prepája vzťahy a ich prejavenie.', bridge:'Informatika a dátové metódy ako priečna infraštruktúra poznania.', fields:['information-sciences'] },
  { id:'malkhut', name:'Malkhut', translation:'Kráľovstvo', pillar:'Stredný pilier', meaning:'Prijímanie a prejavenie; v mnohých výkladoch spájaná so Šechinou.', relation:'Dolný uzol stromu; diagram ho zobrazuje na konci sprostredkujúcej osi.', bridge:'Poľnohospodárske vedy — tematická analógia pre poznanie späté s pôdou a živým svetom.', fields:['agricultural-sciences'] }
];

const fields = [
  { id:'natural-sciences', name:'Prírodné vedy', ref:'Chokhmah', description:'FOS sem zaraďuje aj matematiku a počítačové a informačné vedy.', terms:['matematika','fyzika','astronómia','chémia','geológia','klimatológia','biológia','ekológia','genetika'], categories:[
    {id:'mathematics',name:'Matematika',terms:['matematika','logika','štatistika'],authors:['Euclid','Emmy Noether']},
    {id:'physics-astronomy',name:'Fyzika a astronómia',terms:['fyzika','astronómia','kozmológia'],authors:['Isaac Newton','Albert Einstein','Vera Rubin'],recognize:['Stephen Hawking','Carl Sagan']},
    {id:'earth-sciences',name:'Vedy o Zemi',terms:['geológia','klimatológia','geofyzika'],authors:['James Hutton','Charles Lyell']},
    {id:'life-sciences',name:'Biológia a ekológia',terms:['biológia','ekológia','genetika'],authors:['Charles Darwin','Gregor Mendel','Rosalind Franklin'],recognize:['Jane Goodall','Rachel Carson']}
  ]},
  { id:'engineering-technology', name:'Inžinierstvo a technológie', ref:'Netzach', description:'Aplikovaný návrh, konštrukcia a technologické riešenia.', terms:['stavebné inžinierstvo','elektrotechnika','strojárstvo','materiálová veda','chemické inžinierstvo'], categories:[
    {id:'civil-engineering',name:'Stavebné a environmentálne inžinierstvo',terms:['stavebné inžinierstvo','materiály','dopravné stavby'],authors:['Isambard Kingdom Brunel']},
    {id:'electrical-engineering',name:'Elektrotechnika a elektronika',terms:['elektrotechnika','elektronika','telekomunikácie'],authors:['Nikola Tesla','Edith Clarke']},
    {id:'mechanical-engineering',name:'Strojárstvo a výroba',terms:['strojárstvo','robotika','výroba'],authors:['James Watt','George Stephenson']},
    {id:'chemical-engineering',name:'Chemické inžinierstvo',terms:['chemické inžinierstvo','procesné inžinierstvo','materiálová veda'],authors:['Margaret Hutchinson Rousseau']}
  ]},
  { id:'medical-health-sciences', name:'Lekárske a zdravotnícke vedy', ref:'Chesed', description:'Základná a klinická medicína, verejné zdravie a epidemiológia.', terms:['medicína','biomedicína','klinický výskum','verejné zdravie','epidemiológia'], categories:[
    {id:'basic-medicine',name:'Základná medicína',terms:['anatómia','fyziológia','biomedicína'],authors:['William Harvey','Santiago Ramón y Cajal']},
    {id:'clinical-medicine',name:'Klinická medicína',terms:['medicína','klinický výskum','diagnostika'],authors:['Hippocrates','Alexander Fleming','Jonas Salk']},
    {id:'public-health',name:'Verejné zdravie',terms:['verejné zdravie','epidemiológia','prevencia'],authors:['John Snow','Florence Nightingale']}
  ]},
  { id:'agricultural-sciences', name:'Poľnohospodárske vedy', ref:'Malkhut', description:'Poľnohospodárstvo, lesníctvo, rybárstvo, zvieratá a veterinárstvo.', terms:['poľnohospodárstvo','lesníctvo','rybárstvo','živočíšna veda','veterinárstvo'], categories:[
    {id:'agriculture',name:'Poľnohospodárstvo a agronómia',terms:['poľnohospodárstvo','agronómia','pôda'],authors:['Norman Borlaug','M. S. Swaminathan']},
    {id:'forestry-fisheries',name:'Lesníctvo a rybárstvo',terms:['lesníctvo','rybárstvo','ochrana ekosystémov'],authors:['Gifford Pinchot','Jacques-Yves Cousteau']},
    {id:'veterinary',name:'Živočíšna veda a veterinárstvo',terms:['živočíšna veda','veterinárstvo','chov zvierat'],authors:['Temple Grandin']}
  ]},
  { id:'social-sciences', name:'Spoločenské vedy', ref:'Tiferet', description:'Ľudia, spoločnosť a inštitúcie; psychológia patrí do tohto poľa.', terms:['psychológia','kognícia','kognitívna veda','pamäť','pozornosť','sociológia','ekonómia','pedagogika','právo','politológia','komunikácia'], categories:[
    {id:'psychology-cognition',name:'Psychológia a kognícia',terms:['psychológia','kognícia','kognitívna veda','pamäť','pozornosť'],authors:['William James','Jean Piaget','Lev Vygotsky','Ulric Neisser','Daniel Kahneman'],recognize:['John Bowlby','Mary Ainsworth','Elizabeth Loftus']},
    {id:'sociology',name:'Sociológia a spoločnosť',terms:['sociológia','sociálne inštitúcie','sociálna stratifikácia'],authors:['Émile Durkheim','Max Weber','W. E. B. Du Bois'],recognize:['Pierre Bourdieu']},
    {id:'economics-politics',name:'Ekonomika a politika',terms:['ekonómia','politológia','verejná politika'],authors:['Adam Smith','Elinor Ostrom','Hannah Arendt']},
    {id:'education-law',name:'Vzdelávanie a právo',terms:['pedagogika','právo','komunikácia'],authors:['John Dewey','Paulo Freire']}
  ]},
  { id:'humanities', name:'Humanitné vedy', ref:'Hod', description:'Dejiny, jazyky, literatúra, filozofia a umenie.', terms:['história','archeológia','jazykoveda','literatúra','filozofia','religionistika','etika','dejiny umenia'], categories:[
    {id:'history-archaeology',name:'História a archeológia',terms:['história','archeológia','pramenný výskum'],authors:['Herodotus','Ibn Khaldun','Marc Bloch'],recognize:['Mary Beard']},
    {id:'language-literature',name:'Jazykoveda a literatúra',terms:['jazykoveda','literatúra','filológia'],authors:['Ferdinand de Saussure','Noam Chomsky','Virginia Woolf']},
    {id:'philosophy-religion',name:'Filozofia a religionistika',terms:['filozofia','religionistika','etika'],authors:['Plato','Aristotle','Simone de Beauvoir']},
    {id:'arts',name:'Dejiny umenia',terms:['dejiny umenia','estetika','vizuálna kultúra'],authors:['Johann Joachim Winckelmann']}
  ]},
  { id:'philosophy-of-science', name:'Filozofia vedy a epistemológia', ref:'Keter', description:'Priečna otázka: čo považujeme za poznanie a dôkaz.', terms:['epistemológia','poznanie','vedecká metóda','dôkaz','realizmus'], categories:[
    {id:'epistemology',name:'Epistemológia',terms:['epistemológia','poznanie','zdôvodnenie'],authors:['Plato','Edmund Gettier']},
    {id:'philosophy-science',name:'Filozofia vedy',terms:['vedecká metóda','dôkaz','realizmus'],authors:['Karl Popper','Thomas Kuhn','Imre Lakatos'],recognize:['Paul Feyerabend']}
  ]},
  { id:'research-methods', name:'Metódy a formálne nástroje', ref:'Binah', description:'Metódy sa uplatňujú naprieč odbormi; nejde o siedme pole FOS.', terms:['matematika','logika','štatistika','dizajn výskumu','meranie','metrológia'], categories:[
    {id:'statistics',name:'Štatistika a meranie',terms:['štatistika','meranie','metrológia'],authors:['Ronald Fisher','Karl Pearson','Florence Nightingale'],recognize:['John Tukey']},
    {id:'research-design',name:'Dizajn výskumu',terms:['dizajn výskumu','vzorkovanie','experiment'],authors:['Donald Campbell','Lee Cronbach']},
    {id:'formal-methods',name:'Logika a formálne metódy',terms:['matematika','logika','modelovanie'],authors:['George Boole','Kurt Gödel']}
  ]},
  { id:'research-governance', name:'Etika a integrita výskumu', ref:'Gevurah', description:'Priečne pravidlá: bezpečnosť, transparentnosť a kontrola skreslení.', terms:['etika výskumu','reprodukovateľnosť','skreslenie','kontrolná skupina','recenzné konanie'], categories:[
    {id:'research-ethics',name:'Etika výskumu',terms:['etika výskumu','informovaný súhlas','ochrana účastníkov'],authors:['Tom Beauchamp','James Childress']},
    {id:'integrity-reproducibility',name:'Integrita a reprodukovateľnosť',terms:['reprodukovateľnosť','transparentnosť','otvorená veda'],authors:['Robert Merton','Brian Nosek']},
    {id:'bias-review',name:'Skreslenie a odborné hodnotenie',terms:['skreslenie','kontrolná skupina','recenzné konanie'],authors:['Donald Campbell']}
  ]},
  { id:'interdisciplinary-science', name:'Interdisciplinárny výskum', ref:'Tiferet', description:'Prepája disciplíny; konkrétna klasifikácia závisí od skúmaného výskumu.', terms:['kognitívna veda','systémová veda','interdisciplinarita','multidisciplinárny výskum'], categories:[
    {id:'cognitive-science',name:'Kognitívna veda',terms:['kognitívna veda','psychológia','lingvistika','neuroveda'],authors:['George Miller','Ulric Neisser','Herbert A. Simon']},
    {id:'systems-science',name:'Systémová veda',terms:['systémová veda','kybernetika','komplexné systémy'],authors:['Ludwig von Bertalanffy','Norbert Wiener']},
    {id:'interdisciplinary-methods',name:'Interdisciplinárne metódy',terms:['interdisciplinarita','multidisciplinárny výskum','syntéza poznatkov'],authors:['Julie Thompson Klein']}
  ]},
  { id:'information-sciences', name:'Počítačové a informačné vedy', ref:'Yesod', description:'V FOS 2007 podkategória prírodných vied; tu zobrazená aj ako priečna infraštruktúra.', terms:['informatika','programovanie','softvérové inžinierstvo','dátová veda','umelá inteligencia','strojové učenie'], categories:[
    {id:'computer-science',name:'Informatika a výpočtové modely',terms:['informatika','algoritmus','výpočtová teória'],authors:['Alan Turing','Grace Hopper','Edsger W. Dijkstra'],recognize:['Barbara Liskov']},
    {id:'information-theory',name:'Informačná teória a komunikácia',terms:['informačná teória','kódovanie','komunikácia'],authors:['Claude Shannon','Norbert Wiener']},
    {id:'data-ai',name:'Dátová veda a umelá inteligencia',terms:['dátová veda','umelá inteligencia','strojové učenie'],authors:['John McCarthy','Fei-Fei Li']}
  ]}
];

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
const authorStorageKey = 'knowledge-tree-demo-v1-authors';
const termStorageKey = 'knowledge-tree-demo-v1-terms';
const documentStorageKey = 'knowledge-tree-demo-v1-documents';
let customAuthors = {};
let customTerms = {};
let libraryDocuments = [];
let authorStorageWarning = '';
let termStorageWarning = '';
let documentStorageWarning = '';

function loadCustomAuthors() {
  try {
    const saved = localStorage.getItem(authorStorageKey);
    if (!saved) return;
    const parsed = JSON.parse(saved);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Neplatný formát');
    customAuthors = Object.fromEntries(Object.entries(parsed).map(([fieldId, categories]) => {
      if (!byFieldId(fieldId) || !categories || typeof categories !== 'object' || Array.isArray(categories)) return [fieldId, {}];
      return [fieldId, Object.fromEntries(Object.entries(categories).map(([categoryId, names]) => [
        categoryId,
        Array.isArray(names) ? names.filter(name => typeof name === 'string' && name.trim()).slice(0, 200) : []
      ]))];
    }));
  } catch (error) {
    authorStorageWarning = 'Uložený zoznam autorov sa nepodarilo načítať; ručné zmeny môžu byť dostupné iba do zatvorenia karty.';
  }
}

function saveCustomAuthors() {
  try {
    localStorage.setItem(authorStorageKey, JSON.stringify(customAuthors));
    authorStorageWarning = '';
    return true;
  } catch (error) {
    authorStorageWarning = 'Prehliadač odmietol lokálne uloženie. Zmena zostáva iba do zatvorenia karty.';
    return false;
  }
}

function loadCustomTerms() {
  try {
    const saved = localStorage.getItem(termStorageKey);
    if (!saved) return;
    const parsed = JSON.parse(saved);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Neplatný formát');
    customTerms = Object.fromEntries(Object.entries(parsed).map(([fieldId, categories]) => {
      const field = byFieldId(fieldId);
      if (!field || !categories || typeof categories !== 'object' || Array.isArray(categories)) return [fieldId, {}];
      return [fieldId, Object.fromEntries(Object.entries(categories).map(([categoryId, entries]) => {
        if (!field.categories.some(category => category.id === categoryId) || !Array.isArray(entries)) return [categoryId, []];
        return [categoryId, entries.filter(entry =>
          entry && typeof entry.term === 'string' && entry.term.trim() &&
          typeof entry.description === 'string' && entry.description.trim()
        ).slice(0, 500).map(entry => ({
          term: entry.term.trim().slice(0, 100),
          description: entry.description.trim().slice(0, 500)
        }))];
      }))];
    }));
  } catch (error) {
    termStorageWarning = 'Uloženú terminológiu sa nepodarilo načítať; nové záznamy môžu byť dostupné iba do zatvorenia karty.';
  }
}

function saveCustomTerms() {
  try {
    localStorage.setItem(termStorageKey, JSON.stringify(customTerms));
    termStorageWarning = '';
    return true;
  } catch (error) {
    termStorageWarning = 'Prehliadač odmietol lokálne uloženie. Termín zostáva iba do zatvorenia karty.';
    return false;
  }
}

function loadDocuments() {
  try {
    const saved = localStorage.getItem(documentStorageKey);
    if (!saved) return;
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) throw new Error('Neplatný formát');
    libraryDocuments = parsed.filter(document =>
      document && typeof document.id === 'string' && typeof document.name === 'string' &&
      typeof document.text === 'string' && Array.isArray(document.pages)
    ).map(document => ({
      id: document.id,
      name: document.name.slice(0, 255),
      text: document.text,
      pageKind: document.pageKind === 'original' ? 'original' : 'virtual',
      pages: document.pages.filter(page => page && typeof page.text === 'string').map(page => ({text:page.text}))
    }));
  } catch (error) {
    documentStorageWarning = 'Uložené dokumenty sa nepodarilo načítať. Skús ich pridať znova.';
  }
}

function saveDocuments() {
  try {
    localStorage.setItem(documentStorageKey, JSON.stringify(libraryDocuments));
    documentStorageWarning = '';
    return true;
  } catch (error) {
    documentStorageWarning = 'Úložisko prehliadača je plné alebo nedostupné. Dokument sa nezachoval; skús menší textový súbor.';
    return false;
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
  return customTerms[field.id]?.[category.id] || [];
}

function catalogTermsFor(field) {
  const added = field.categories.flatMap(category => termsFor(field, category).map(item => item.term));
  return [...new Set([...field.terms, ...added])];
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

function findTextRanges(text, term) {
  const needle = normalize(term);
  if (!needle) return [];
  const {normalized,starts,ends} = normalizedTextWithOffsets(text);
  const ranges = [];
  let position = 0;
  while ((position = normalized.indexOf(needle,position)) !== -1) {
    const before = normalized[position - 1] || '';
    const after = normalized[position + needle.length] || '';
    const isWordCharacter = character => /[\p{L}\p{N}]/u.test(character);
    if (!isWordCharacter(before) && !isWordCharacter(after)) {
      ranges.push({start:starts[position],end:ends[position + needle.length - 1]});
    }
    position += needle.length;
  }
  return ranges;
}

function pagesForText(text) {
  if (text.includes('\f')) {
    return {pageKind:'original',pages:text.split('\f').map(page => ({text:page}))};
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
    pages.push({text:text.slice(start,end)});
    start = end;
  }
  return {pageKind:'virtual',pages:pages.length ? pages : [{text:''}]};
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
  document.querySelector('#document-count').textContent = `${libraryDocuments.length} dokumentov`;
  document.querySelector('#document-list').innerHTML = libraryDocuments.length
    ? libraryDocuments.map(item => `<div class="document-row"><span class="document-icon" aria-hidden="true">▤</span><span class="document-name">${escapeHtml(item.name)}</span><span class="document-pages">${item.pages.length} ${item.pageKind === 'original' ? 'strán' : 'virtuálnych strán'}</span></div>`).join('')
    : '<p class="empty-library">Zatiaľ tu nie sú pridané žiadne dokumenty.</p>';
  document.querySelector('#upload-status').textContent = documentStorageWarning;
}

function renderTermAssets() {
  const panel = document.querySelector('#term-assets');
  const reader = document.querySelector('#document-reader');
  if (!selectedTerm) {
    panel.hidden = true;
    reader.hidden = true;
    return;
  }
  panel.hidden = false;
  const results = libraryDocuments.map(document => ({
    document,
    matches:documentMatches(document,selectedTerm.term)
  })).filter(result => result.matches.length);
  panel.innerHTML = `<div class="term-assets-heading">
    <span class="term-visual selected">${escapeHtml(selectedTerm.term)}</span>
    <div><h4>Dokumenty obsahujúce tento termín</h4><p>${escapeHtml(selectedTerm.description || 'Výskyty presného textového termínu v lokálnej knižnici.')}</p></div>
  </div>
  ${results.length ? `<div class="matching-documents">${results.map(({document,matches}) =>
    `<button class="matching-document" type="button" data-document="${escapeHtml(document.id)}">
      <span class="document-icon" aria-hidden="true">▤</span>
      <span class="matching-document-name">${escapeHtml(document.name)}</span>
      <span class="match-summary">${matches.reduce((sum,item)=>sum+item.ranges.length,0)} výskytov · strany ${matches.map(item=>item.page+1).join(', ')}</span>
    </button>`
  ).join('')}</div>` : '<p class="empty-library">V pridaných dokumentoch sa tento termín zatiaľ nenašiel.</p>'}`;
  panel.querySelectorAll('.matching-document').forEach(button => button.addEventListener('click',() => {
    openDocumentMatch(button.dataset.document,0);
  }));
  renderReader();
}

function openDocumentMatch(documentId, matchIndex) {
  const docItem = libraryDocuments.find(item => item.id === documentId);
  if (!docItem || !selectedTerm) return;
  const matches = documentMatches(docItem,selectedTerm.term)
    .flatMap(page => page.ranges.map(range => ({page:page.page,range})));
  if (!matches.length) return;
  readerState = {documentId,matchIndex:Math.max(0,Math.min(matchIndex,matches.length-1))};
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
  const current = matches[readerState.matchIndex];
  if (!current) {
    reader.hidden = true;
    return;
  }
  const pageText = item.pages[current.page].text;
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
    ? `Strana ${current.page+1} · oddelená v texte`
    : `Strana ${current.page+1} · imaginárna (virtuálne rozdelenie)`;
  document.querySelector('#occurrence-count').textContent = `Výskyt ${readerState.matchIndex+1} z ${matches.length}`;
  document.querySelector('#previous-occurrence').disabled = matches.length < 2;
  document.querySelector('#next-occurrence').disabled = matches.length < 2;
  document.querySelector('#reader-page').innerHTML = marked || '<span class="empty-page">Táto strana neobsahuje čitateľný text.</span>';
}

function renderFieldMap(field) {
  document.querySelector('#map-field-title').textContent = field.name;
  document.querySelector('#field-map-content').innerHTML = field.categories.map((category,categoryIndex) => {
    const authors = authorsFor(field, category);
    const entries = termEntriesFor(field,category);
    return `<article class="subcategory-card">
      <h4>${escapeHtml(category.name)}</h4>
      <div class="concept-term-list">${entries.map((entry,index) => `<button type="button" class="concept-term" data-category="${escapeHtml(category.id)}" data-term-index="${index}" style="--term-hue:${(index*53+categoryIndex*37)%360}">
        <span class="term-visual"><span class="term-orbit" aria-hidden="true"></span>${escapeHtml(entry.term)}</span>
        ${entry.description ? `<span class="concept-term-description">${escapeHtml(entry.description)}</span>` : ''}
      </button>`).join('')}</div>
      <p class="authors-label">Autori a myslitelia · orientačný výber</p>
      <div class="author-list">${authors.length
        ? authors.map(name => `<span class="author-chip">${escapeHtml(name)}</span>`).join('')
        : '<span class="author-empty">Zatiaľ bez mien</span>'}</div>
    </article>`;
  }).join('');
  document.querySelector('#manual-author-category').innerHTML = field.categories
    .map(category => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`).join('');
  document.querySelector('#term-category').innerHTML = field.categories
    .map(category => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`).join('');
  document.querySelector('#author-detection-status').textContent = authorStorageWarning;
  document.querySelector('#term-status').textContent = termStorageWarning;
  document.querySelectorAll('.concept-term').forEach(button => button.addEventListener('click',() => {
    const category = field.categories.find(item => item.id === button.dataset.category);
    const entry = category && termEntriesFor(field,category)[Number(button.dataset.termIndex)];
    if (!entry) return;
    selectedTerm = {fieldId:field.id,categoryId:category.id,term:entry.term,description:entry.description};
    readerState = null;
    renderTermAssets();
  }));
  renderTermAssets();
}

function addCustomTerm(field, category, term, description) {
  const normalizedTerm = normalize(term.trim());
  const existsInBuiltIns = category.terms.some(existing => normalize(existing) === normalizedTerm);
  const existsInCustom = termsFor(field, category).some(existing => normalize(existing.term) === normalizedTerm);
  if (existsInBuiltIns || existsInCustom) return false;
  customTerms[field.id] ||= {};
  customTerms[field.id][category.id] ||= [];
  customTerms[field.id][category.id].push({term:term.trim(), description:description.trim()});
  saveCustomTerms();
  return true;
}

function addCustomAuthor(field, category, name) {
  const normalizedName = normalize(name.trim());
  const existingNames = authorsFor(field, category);
  if (existingNames.some(existing => normalize(existing) === normalizedName)) return false;
  customAuthors[field.id] ||= {};
  customAuthors[field.id][category.id] ||= [];
  customAuthors[field.id][category.id].push(name.trim());
  saveCustomAuthors();
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
function matchesSearch(text) { return !searchTerm || normalize(text).includes(normalize(searchTerm)); }

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
  document.querySelector('#field-list').innerHTML = visibleFields.map(field => `<button type="button" class="field-card ${selectedField === field.id ? 'active' : ''}" data-field="${field.id}"><span>${field.name}</span><small>${field.terms.length} pojmov</small></button>`).join('');
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
}

drawTree();
drawCatalog();
loadCustomAuthors();
loadCustomTerms();
loadDocuments();
render();
renderDocumentLibrary();

document.querySelector('#search').addEventListener('input',event => { searchTerm = event.target.value.trim(); selectedField = ''; if (searchTerm) activeView = 'overview'; render(); });
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
document.querySelector('#manual-author-form').addEventListener('submit',event => {
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
  const added = addCustomAuthor(field, category, name);
  input.value = '';
  render();
  status.textContent = added
    ? authorStorageWarning || `Ručne pridaný autor: ${name}.`
    : `Meno ${name} už v tejto podkategórii je.`;
});
document.querySelector('#detect-authors').addEventListener('click',() => {
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
  recognized.forEach(({name, category}) => {
    if (addCustomAuthor(field, category, name)) added.push(name);
  });
  render();
  const categories = [...new Set(recognized.map(item => item.category.name))].join(', ');
  status.textContent = `${authorStorageWarning ? `${authorStorageWarning} ` : ''}Rozpoznané mená: ${names.join(', ')}. Podkategórie: ${categories}.${added.length ? ` Automaticky pridané: ${[...new Set(added)].join(', ')}.` : ' Tieto mená už v mape sú.'}`;
});
document.querySelector('#custom-term-form').addEventListener('submit',event => {
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
  if (!addCustomTerm(field, category, term, description)) {
    status.textContent = `Termín „${term}“ už v tejto podkategórii existuje.`;
    return;
  }
  termInput.value = '';
  descriptionInput.value = '';
  render();
  status.textContent = `${termStorageWarning ? `${termStorageWarning} ` : ''}Termín „${term}“ bol pridaný do podkategórie ${category.name}.`;
});
document.querySelector('#document-upload').addEventListener('change',async event => {
  const input = event.currentTarget;
  const files = [...input.files];
  const added = [], rejected = [];
  for (const file of files) {
    if (!/\.(txt|md|markdown|csv|log)$/i.test(file.name)) {
      rejected.push(`${file.name}: nepodporovaný formát`);
      continue;
    }
    try {
      const text = await file.text();
      if (!text.trim()) {
        rejected.push(`${file.name}: súbor neobsahuje text`);
        continue;
      }
      const split = pagesForText(text);
      const documentEntry = {
        id:globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name:file.name,
        size:file.size,
        text,
        pageKind:split.pageKind,
        pages:split.pages
      };
      libraryDocuments.push(documentEntry);
      if (saveDocuments()) {
        added.push(`${file.name} (${split.pages.length} ${split.pageKind === 'original' ? 'oddelených' : 'imaginárnych strán'})`);
      } else {
        libraryDocuments.pop();
        rejected.push(`${file.name}: ${documentStorageWarning}`);
      }
    } catch (error) {
      rejected.push(`${file.name}: súbor sa nepodarilo prečítať`);
    }
  }
  input.value = '';
  renderDocumentLibrary();
  const status = document.querySelector('#upload-status');
  status.textContent = [
    added.length ? `Pridané: ${added.join('; ')}.` : '',
    rejected.length ? `Nevložené: ${rejected.join('; ')}.` : ''
  ].filter(Boolean).join(' ');
});
document.querySelector('#previous-occurrence').addEventListener('click',() => {
  if (!readerState) return;
  const item = libraryDocuments.find(document => document.id === readerState.documentId);
  const count = item ? documentMatches(item,selectedTerm.term).reduce((sum,page)=>sum+page.ranges.length,0) : 0;
  if (count) {
    readerState.matchIndex = (readerState.matchIndex - 1 + count) % count;
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
  }
});
document.querySelector('#reset').addEventListener('click',() => {
  selectedId = 'keter'; selectedField = ''; selectedTerm = null; readerState = null; searchTerm = ''; activeView = 'bridge';
  document.querySelector('#search').value = '';
  render();
});
document.addEventListener('keydown',event => {
  if (event.key === '/' && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault(); document.querySelector('#search').focus(); }
  if (event.key === 'Escape' && document.activeElement.id === 'search') { document.querySelector('#search').value = ''; searchTerm = ''; selectedField = ''; activeView = 'bridge'; render(); }
});
