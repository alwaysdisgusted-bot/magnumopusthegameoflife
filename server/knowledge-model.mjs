const KnowledgeModel = (function () {
  'use strict';
  /** @typedef {{id:string,parentId:string|null,name:string,keywords:string[],studyCategoryId:string|null}} KnowledgeConcept */
  /** @typedef {{id:string,sourceKind:string,sourceId:string,title:string,text:string,assetId:string|null,mime:string,conceptIds:string[],manualConceptIds:string[],excludedConceptIds:string[],analysisStatus:string,analyzedAt:number,updatedAt:number,pages:Array<{number:number,text:string}>,pagination:string}} KnowledgeResource */
  /** @typedef {{version:number,concepts:KnowledgeConcept[],resources:KnowledgeResource[]}} KnowledgeState */
  var MAX_BYTES = 20 * 1024 * 1024;
  var KINDS = ['upload', 'book', 'page', 'daynote', 'study', 'library-photo', 'desk-photo'];
  var MIMES = ['', 'text/plain', 'text/markdown', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/png', 'image/jpeg', 'image/webp'];
  function fail(message) { throw new Error(message); }
  function plain(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail('Očakáva sa obyčajný objekt.');
    Reflect.ownKeys(value).forEach(function (key) {
      if (typeof key !== 'string' || keys.indexOf(key) < 0 || !Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(value, key), 'value')) fail('Nepovolené pole znalostnej mapy.');
    });
    return value;
  }
  function list(value, max) {
    if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) fail('Neplatný alebo príliš dlhý zoznam.');
    for (var i = 0; i < value.length; i++) {
      var descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) fail('Neplatná položka zoznamu.');
    }
    return value;
  }
  function text(value, max, required) {
    if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail('Neplatný alebo príliš dlhý text.');
    return value;
  }
  function id(value) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(value) || ['__proto__', 'constructor', 'prototype'].indexOf(value) >= 0) fail('Neplatný identifikátor.');
    return value;
  }
  function integer(value) {
    if (!Number.isSafeInteger(value) || value < 0) fail('Neplatný dátum.');
    return value;
  }
  function normalize(value) { return String(value == null ? '' : value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/ +/g, ' '); }
  var SEFIROT = Object.freeze([
    { id: 'keter', name: 'Keter', translation: 'Koruna', pillar: 'stredný', meaning: 'Najvyššia a skrytá sféra; v mnohých výkladoch vôľa alebo transcendentný potenciál.', relation: 'Vrch hornej triády Keter–Chokhmah–Binah; predstavuje zdrojový pól schémy.', scienceLens: 'Filozofia vedy a epistemológia — otázky, predpoklady a hranice poznania. Ide o voľnú analógiu, nie kabalistické učenie o vede.' },
    { id: 'chokhmah', name: 'Chokhmah', translation: 'Múdrosť', pillar: 'pravý', meaning: 'Prvotný záblesk tvorivej intuície alebo vhľadu.', relation: 'Pravý pól hornej triády; v páre s Binah tvorí kontrast prvotného vhľadu a rozvinutého porozumenia.', scienceLens: 'Prírodné vedy — tvorba otázok, hypotéz a modelov; nejde o tvrdenie, že intuícia sama je vedecký dôkaz.' },
    { id: 'binah', name: 'Binah', translation: 'Porozumenie', pillar: 'ľavý', meaning: 'Rozvinutie, rozlišovanie a uchopenie prvotného vhľadu.', relation: 'Ľavý pól hornej triády; Chokhmah a Binah sa v mnohých výkladoch chápu vzťahovo, nie izolovane.', scienceLens: 'Formálne a metodologické nástroje — matematika, logika, štatistika a návrh výskumu. Matematiku FOS 2007 zaraďuje pod prírodné vedy.' },
    { id: 'chesed', name: 'Chesed', translation: 'Láskavosť', pillar: 'pravý', meaning: 'Rozširujúca sa štedrosť, milosrdenstvo alebo láskavá priazeň.', relation: 'Pravý pól strednej triády; spolu s Gevurah tvorí dvojicu expanzie a obmedzenia, ktorú v schéme vyvažuje Tiferet.', scienceLens: 'Lekárske a zdravotnícke vedy — starostlivosť o zdravie a život. Je to hodnotová analógia, nie odvodenie medicíny z kabaly.' },
    { id: 'gevurah', name: 'Gevurah', translation: 'Sila / prísnosť', pillar: 'ľavý', meaning: 'Obmedzenie, disciplína a súd; v napätí a rovnováhe s Chesed.', relation: 'Ľavý pól strednej triády; spolu s Chesed je často vyvažovaná Tiferet.', scienceLens: 'Etika výskumu, pravidlá, kontrola skreslení a reprodukovateľnosť — priečne zásady, nie samostatný hlavný odbor FOS.' },
    { id: 'tiferet', name: 'Tiferet', translation: 'Krása', pillar: 'stredný', meaning: 'Harmónia a rovnováha; často sprostredkuje medzi Chesed a Gevurah.', relation: 'Stredný uzol strednej triády; v bežných diagramoch sprostredkuje napätie Chesed–Gevurah.', scienceLens: 'Spoločenské a interdisciplinárne vedy — skúmanie vzťahov a syntéza perspektív. Psychológiu FOS 2007 výslovne zaraďuje medzi spoločenské vedy.' },
    { id: 'netzach', name: 'Netzach', translation: 'Trvanie / víťazstvo', pillar: 'pravý', meaning: 'Vytrvalosť a pretrvanie; preklad aj dôraz sa líšia podľa výkladu.', relation: 'Pravý pól dolnej dvojice Netzach–Hod; schémy zobrazujú viacero ciest k Yesod a Malkhut.', scienceLens: 'Inžinierstvo a technológie — navrhovanie a uskutočnenie riešení; praktická analógia, nie historická väzba.' },
    { id: 'hod', name: 'Hod', translation: 'Vznešenosť / sláva', pillar: 'ľavý', meaning: 'Vznešenosť a uznanie; často sa uvádza v páre s Netzach.', relation: 'Ľavý pól dvojice Netzach–Hod; v schémach sa prepája s Yesod a Malkhut.', scienceLens: 'Humanitné vedy — historická, jazyková, filozofická a interpretačná práca. Oficiálne pole FOS 2007.' },
    { id: 'yesod', name: 'Yesod', translation: 'Základ', pillar: 'stredný', meaning: 'Základ a sprostredkujúce spojenie s Malkhut.', relation: 'Stredný sprostredkujúci uzol; spája strednú a dolnú časť stromu a susedí s Malkhut.', scienceLens: 'Informatika, informačné systémy a dátové metódy ako priečna infraštruktúra poznania. FOS 2007 klasifikuje počítačové a informačné vedy pod prírodné vedy.' },
    { id: 'malkhut', name: 'Malkhut', translation: 'Kráľovstvo', pillar: 'stredný', meaning: 'Prijímanie a prejavenie; v mnohých výkladoch spájané so Šechinou.', relation: 'Dolný uzol stromu; v tomto schematickom zobrazení prijíma spojenie cez Yesod.', scienceLens: 'Poľnohospodárske vedy a praktické pôsobenie vo svete — tematická analógia. Oficiálne pole FOS 2007.' }
  ].map(function (item) { return Object.freeze(item); }));
  var LORE_TERMS = Object.freeze([
    { name: 'Ein Sof', translation: 'Bez konca', meaning: 'Označenie nekonečného božského; nie je jednou z desiatich Sefirot.' },
    { name: 'Or', translation: 'Svetlo', meaning: 'Častý obraz v kabalistických textoch pre božské pôsobenie alebo zjavenie; význam závisí od kontextu.' },
    { name: 'Da’at', translation: 'Poznanie', meaning: 'V niektorých systémoch skrytý či integračný pojem; v určitých schémach zastupuje Keter pri počítaní desiatich, nie je všeobecne jedenástou Sefirou.' },
    { name: 'Šechina', translation: 'Božia prítomnosť', meaning: 'Pojem božskej prítomnosti; v mnohých kabalistických výkladoch sa spája s Malkhut.' },
    { name: 'Cimcum (Tzimtzum)', translation: 'Stiahnutie / zúženie', meaning: 'Pojem najmä lurijánskej kabaly pre skrytie alebo stiahnutie, ktorým sa vysvetľuje priestor pre stvorenie; výklady sa líšia.' },
    { name: '32 ciest múdrosti', translation: '10 Sefirot + 22 písmen', meaning: 'Výraz spájaný s knihou Sefer Jecira. Graf používa jednu schematickú konfiguráciu spojení a nepriraďuje im hebrejské písmená; diagramy a výklady sa líšia.' }
  ].map(function (item) { return Object.freeze(item); }));
  var TAXONOMY = SEFIROT.map(function (item) {
    return { id: 'sefirah-' + item.id, parentId: null, name: item.name, keywords: [item.name, item.translation] };
  }).concat([
    { id: 'philosophy-of-science', parentId: 'sefirah-keter', name: 'Filozofia vedy a epistemológia', keywords: ['filozofia vedy', 'philosophy of science', 'epistemológia', 'epistemology', 'teória poznania'] },
    { id: 'natural-sciences', parentId: 'sefirah-chokhmah', name: 'Prírodné vedy', keywords: ['prírodné vedy', 'natural sciences', 'natural science'] },
    { id: 'mathematics', parentId: 'natural-sciences', name: 'Matematika', keywords: ['matematika', 'mathematics', 'mathematical'] },
    { id: 'physical-sciences', parentId: 'natural-sciences', name: 'Fyzikálne vedy', keywords: ['fyzikálne vedy', 'physical sciences'] },
    { id: 'physics', parentId: 'physical-sciences', name: 'Fyzika', keywords: ['fyzika', 'physics', 'fyzikálny'] },
    { id: 'astronomy', parentId: 'physical-sciences', name: 'Astronómia', keywords: ['astronómia', 'astronomy', 'astrofyzika', 'astrophysics'] },
    { id: 'chemical-sciences', parentId: 'natural-sciences', name: 'Chemické vedy', keywords: ['chemické vedy', 'chemical sciences'] },
    { id: 'chemistry', parentId: 'chemical-sciences', name: 'Chémia', keywords: ['chémia', 'chemistry', 'chemický'] },
    { id: 'earth-environmental-sciences', parentId: 'natural-sciences', name: 'Vedy o Zemi a životnom prostredí', keywords: ['vedy o zemi', 'earth sciences', 'environmental sciences', 'environmentálne vedy'] },
    { id: 'geology', parentId: 'earth-environmental-sciences', name: 'Geológia', keywords: ['geológia', 'geology', 'geologický'] },
    { id: 'climate-science', parentId: 'earth-environmental-sciences', name: 'Klimatológia', keywords: ['klimatológia', 'climatology', 'climate science', 'klimatická veda'] },
    { id: 'biological-sciences', parentId: 'natural-sciences', name: 'Biologické vedy', keywords: ['biologické vedy', 'biological sciences', 'life sciences', 'vedy o živote'] },
    { id: 'biology', parentId: 'biological-sciences', name: 'Biológia', keywords: ['biológia', 'biology', 'biologický'] },
    { id: 'ecology', parentId: 'biological-sciences', name: 'Ekológia', keywords: ['ekológia', 'ecology', 'ekologický'] },
    { id: 'genetics', parentId: 'biological-sciences', name: 'Genetika', keywords: ['genetika', 'genetics', 'genetický'] },
    { id: 'research-methods', parentId: 'sefirah-binah', name: 'Metódy a formálne nástroje', keywords: ['metodológia', 'research methodology', 'výskumná metóda', 'research methods', 'formálne metódy'] },
    { id: 'statistics', parentId: 'research-methods', name: 'Štatistika', keywords: ['štatistika', 'statistics', 'štatistický'] },
    { id: 'logic', parentId: 'research-methods', name: 'Logika', keywords: ['logika', 'logic', 'logický'] },
    { id: 'research-design', parentId: 'research-methods', name: 'Dizajn výskumu', keywords: ['dizajn výskumu', 'research design', 'metodika výskumu'] },
    { id: 'measurement', parentId: 'research-methods', name: 'Meranie a metrológia', keywords: ['meranie', 'measurement', 'metrológia', 'metrology'] },
    { id: 'medical-health-sciences', parentId: 'sefirah-chesed', name: 'Lekárske a zdravotnícke vedy', keywords: ['lekárske vedy', 'medical sciences', 'health sciences', 'zdravotnícke vedy', 'medicína', 'medicine'] },
    { id: 'basic-medicine', parentId: 'medical-health-sciences', name: 'Základná medicína', keywords: ['základná medicína', 'basic medicine', 'biomedicína', 'biomedicine'] },
    { id: 'clinical-medicine', parentId: 'medical-health-sciences', name: 'Klinická medicína', keywords: ['klinická medicína', 'clinical medicine', 'klinické vedy'] },
    { id: 'public-health', parentId: 'medical-health-sciences', name: 'Verejné zdravie', keywords: ['verejné zdravie', 'public health', 'epidemiológia', 'epidemiology'] },
    { id: 'science-governance', parentId: 'sefirah-gevurah', name: 'Etika a pravidlá výskumu', keywords: ['etika výskumu', 'research ethics', 'integrita výskumu', 'research integrity', 'reprodukovateľnosť', 'reproducibility'] },
    { id: 'research-bias', parentId: 'science-governance', name: 'Skreslenie a kontrola dôkazov', keywords: ['skreslenie', 'bias', 'kontrolná skupina', 'control group', 'recenzné konanie', 'peer review'] },
    { id: 'social-sciences', parentId: 'sefirah-tiferet', name: 'Spoločenské vedy', keywords: ['spoločenské vedy', 'social sciences', 'social science'] },
    { id: 'psychology', parentId: 'social-sciences', name: 'Psychológia', keywords: ['psychológia', 'psychology', 'psychologický'] },
    { id: 'cognition', parentId: 'psychology', name: 'Kognícia', keywords: ['kognícia', 'kognitívny', 'cognition', 'cognitive', 'myslenie'] },
    { id: 'cognitive-science', parentId: 'cognition', name: 'Kognitívna veda', keywords: ['kognitívna veda', 'cognitive science', 'kognitívne vedy'] },
    { id: 'memory', parentId: 'cognition', name: 'Pamäť', keywords: ['pamäť', 'memory', 'zapamätanie'] },
    { id: 'attention', parentId: 'cognition', name: 'Pozornosť', keywords: ['pozornosť', 'attention', 'sústredenie'] },
    { id: 'learning', parentId: 'cognition', name: 'Učenie', keywords: ['učenie', 'learning', 'vzdelávanie'] },
    { id: 'emotions', parentId: 'psychology', name: 'Emócie', keywords: ['emócia', 'emócie', 'emotion', 'emotional'] },
    { id: 'motivation', parentId: 'psychology', name: 'Motivácia', keywords: ['motivácia', 'motivation', 'motivovať'] },
    { id: 'economics-business', parentId: 'social-sciences', name: 'Ekonómia a podnikanie', keywords: ['ekonómia', 'economics', 'business studies', 'podnikanie', 'ekonomika'] },
    { id: 'finance', parentId: 'economics-business', name: 'Financie', keywords: ['financie', 'finance', 'financial', 'peniaze'] },
    { id: 'saving', parentId: 'finance', name: 'Úspory', keywords: ['úspory', 'sporenie', 'saving', 'savings'] },
    { id: 'investing', parentId: 'finance', name: 'Investovanie', keywords: ['investovanie', 'investície', 'investing', 'investment'] },
    { id: 'educational-sciences', parentId: 'social-sciences', name: 'Pedagogické vedy', keywords: ['pedagogické vedy', 'educational sciences', 'education research', 'veda o vzdelávaní'] },
    { id: 'sociology', parentId: 'social-sciences', name: 'Sociológia', keywords: ['sociológia', 'sociology', 'sociologický'] },
    { id: 'law', parentId: 'social-sciences', name: 'Právo', keywords: ['právo', 'law', 'legal studies', 'právny'] },
    { id: 'political-science', parentId: 'social-sciences', name: 'Politológia', keywords: ['politológia', 'political science', 'political sciences', 'politika'] },
    { id: 'social-geography', parentId: 'social-sciences', name: 'Sociálna a ekonomická geografia', keywords: ['sociálna geografia', 'social geography', 'economic geography', 'ekonomická geografia'] },
    { id: 'media-communications', parentId: 'social-sciences', name: 'Médiá a komunikácia', keywords: ['mediálne štúdiá', 'media studies', 'komunikácia', 'communications', 'komunikačné vedy'] },
    { id: 'interdisciplinary-science', parentId: 'sefirah-tiferet', name: 'Interdisciplinárny výskum', keywords: ['interdisciplinárny', 'interdisciplinary', 'multidisciplinárny', 'multidisciplinary', 'interdisciplinárny výskum'] },
    { id: 'systems-science', parentId: 'interdisciplinary-science', name: 'Systémová veda', keywords: ['systémová veda', 'systems science', 'systémový prístup', 'systems thinking'] },
    { id: 'engineering-technology', parentId: 'sefirah-netzach', name: 'Inžinierstvo a technológie', keywords: ['inžinierstvo', 'engineering', 'technológie', 'technology', 'technológia'] },
    { id: 'civil-engineering', parentId: 'engineering-technology', name: 'Stavebné inžinierstvo', keywords: ['stavebné inžinierstvo', 'civil engineering'] },
    { id: 'electrical-information-engineering', parentId: 'engineering-technology', name: 'Elektrotechnika a informačné inžinierstvo', keywords: ['elektrotechnika', 'electrical engineering', 'information engineering'] },
    { id: 'mechanical-engineering', parentId: 'engineering-technology', name: 'Strojárstvo', keywords: ['strojárstvo', 'mechanical engineering', 'mechanické inžinierstvo'] },
    { id: 'chemical-engineering', parentId: 'engineering-technology', name: 'Chemické inžinierstvo', keywords: ['chemické inžinierstvo', 'chemical engineering'] },
    { id: 'materials-engineering', parentId: 'engineering-technology', name: 'Materiálové inžinierstvo', keywords: ['materiálové inžinierstvo', 'materials engineering', 'materiálová veda'] },
    { id: 'technology', parentId: 'engineering-technology', name: 'Technológie', keywords: ['technológia', 'technológie', 'technology', 'technological'] },
    { id: 'humanities', parentId: 'sefirah-hod', name: 'Humanitné vedy', keywords: ['humanitné vedy', 'humanities', 'humanity'] },
    { id: 'history-archaeology', parentId: 'humanities', name: 'Dejiny a archeológia', keywords: ['dejiny', 'história', 'history', 'archaeology', 'archeológia'] },
    { id: 'languages-literature', parentId: 'humanities', name: 'Jazyky a literatúra', keywords: ['jazykoveda', 'linguistics', 'literatúra', 'literature', 'philology', 'filológia'] },
    { id: 'philosophy', parentId: 'humanities', name: 'Filozofia a religionistika', keywords: ['filozofia', 'philosophy', 'religion studies', 'religionistika', 'filozofický'] },
    { id: 'ethics', parentId: 'philosophy', name: 'Etika', keywords: ['etika', 'ethics', 'morálka', 'morality'] },
    { id: 'arts', parentId: 'humanities', name: 'Umenie a umelecké vedy', keywords: ['umenie', 'arts', 'art history', 'dejiny umenia', 'umelecké vedy'] },
    { id: 'information-sciences', parentId: 'sefirah-yesod', name: 'Počítačové a informačné vedy', keywords: ['počítačové vedy', 'computer science', 'computer and information sciences', 'informatika', 'information science'] },
    { id: 'programming', parentId: 'information-sciences', name: 'Programovanie a softvérové inžinierstvo', keywords: ['programovanie', 'programming', 'softvér', 'software', 'software engineering'] },
    { id: 'data-science', parentId: 'information-sciences', name: 'Dátová veda', keywords: ['dátová veda', 'data science', 'dátová analytika', 'data analytics'] },
    { id: 'artificial-intelligence', parentId: 'information-sciences', name: 'Umelá inteligencia a strojové učenie', keywords: ['umelá inteligencia', 'artificial intelligence', 'strojové učenie', 'machine learning'] },
    { id: 'agricultural-sciences', parentId: 'sefirah-malkhut', name: 'Poľnohospodárske vedy', keywords: ['poľnohospodárske vedy', 'agricultural sciences', 'agricultural science'] },
    { id: 'agriculture-forestry-fisheries', parentId: 'agricultural-sciences', name: 'Poľnohospodárstvo, lesníctvo a rybárstvo', keywords: ['poľnohospodárstvo', 'agriculture', 'lesníctvo', 'forestry', 'rybárstvo', 'fisheries'] },
    { id: 'animal-dairy-science', parentId: 'agricultural-sciences', name: 'Živočíšna a mliekarenská veda', keywords: ['živočíšna veda', 'animal science', 'dairy science', 'mliekarenská veda'] },
    { id: 'veterinary-science', parentId: 'agricultural-sciences', name: 'Veterinárna veda', keywords: ['veterinárna veda', 'veterinary science', 'veterinárstvo'] },
    { id: 'agricultural-biotechnology', parentId: 'agricultural-sciences', name: 'Poľnohospodárska biotechnológia', keywords: ['poľnohospodárska biotechnológia', 'agricultural biotechnology'] }
  ]);
  // Only known linguistic stems are expanded. Custom keywords use complete words
  // or phrases, so e.g. "AI" never matches an unrelated word containing "ai".
  var FORMS = {
    psychologia: /^psycholog(?:ia|ie|ii|iu|iou|icky|icka|icke|icki|ickych|ickym|ickymi|ickej|ickeho|ickemu)$/,
    kognicia: /^kognic(?:ia|ie|ii|iu|iou)$/,
    kognitivny: /^kognitivn(?:y|a|e|i|u|ym|ymi|ych|ej|eho|emu|ou|om)$/,
    pamat: /^pamat(?:i|ou|ovy|ova|ove|ovych|ovym|ovymi|ovej|oveho|ovemu)?$/,
    pozornost: /^pozornost(?:i|ou)?$/,
    emocia: /^emoc(?:ia|ie|ii|iu|iou|iam|iami|ionalny|ionalna|ionalne|ionalnych)$/,
    motivacia: /^motivac(?:ia|ie|ii|iu|iou|ny|na|ne|nych|neho)$/,
    ucenie: /^uceni(?:e|a|u|m)$/,
    financie: /^finan(?:cie|cii|ciam|ciami|ciach|cny|cna|cne|cnych|cneho|cnym)$/,
    uspory: /^uspor(?:y|a|am|ami|ach)?$/,
    investicie: /^invest(?:icia|icie|icii|iciam|iciami|iciach|ovanie|ovania|ovaniu)$/,
    filozofia: /^filozof(?:ia|ie|ii|iu|iou|icky|icka|icke|ickych|ickeho)$/,
    etika: /^etik(?:a|y|e|u|ou)$/,
    technologia: /^technolog(?:ia|ie|ii|iu|iou|iam|iami|icky|icka|icke|ickych)$/,
    programovanie: /^programovani(?:e|a|u|m)$/
  };
  function cloneConcept(concept) { return { id: concept.id, parentId: concept.parentId, name: concept.name, keywords: concept.keywords.slice(), studyCategoryId: concept.studyCategoryId == null ? null : concept.studyCategoryId }; }
  /** @returns {KnowledgeState} */
  function createState() { return { version: 1, concepts: TAXONOMY.map(cloneConcept), resources: [] }; }
  /** @returns {KnowledgeState} */
  function validateState(value) {
    plain(value, ['version', 'concepts', 'resources']);
    if (value.version !== 1) fail('Nepodporovaná verzia znalostnej mapy.');
    /** @type {KnowledgeState} */
    var clean = { version: 1, concepts: [], resources: [] };
    var conceptIds = new Set(), resourceIds = new Set(), byId = new Map();
    clean.concepts = list(value.concepts, 2000).map(function (concept) {
      plain(concept, ['id', 'parentId', 'name', 'keywords', 'studyCategoryId']);
      var conceptId = id(concept.id);
      if (conceptIds.has(conceptId)) fail('Duplicitný pojem.');
      conceptIds.add(conceptId);
      var result = { id: conceptId, parentId: concept.parentId === null ? null : id(concept.parentId), name: text(concept.name, 160, true), keywords: list(concept.keywords, 50).map(function (word) { return text(word, 100, true); }), studyCategoryId: concept.studyCategoryId == null ? null : id(concept.studyCategoryId) };
      byId.set(conceptId, result); return result;
    });
    clean.concepts.forEach(function (concept) {
      var current = concept, visited = new Set();
      while (current) {
        if (visited.has(current.id)) fail('Pojmy nesmú vytvárať kruh.');
        visited.add(current.id);
        if (visited.size > 30) fail('Mapa môže mať najviac 30 úrovní.');
        if (current.parentId === null) break;
        current = byId.get(current.parentId);
        if (!current) fail('Nadradený pojem neexistuje.');
      }
    });
    function links(value) {
      var seen = new Set();
      return list(value, 2000).map(function (value) {
        id(value);
        if (!conceptIds.has(value) || seen.has(value)) fail('Neplatné alebo duplicitné prepojenie pojmu.');
        seen.add(value); return value;
      });
    }
    clean.resources = list(value.resources, 5000).map(function (resource) {
      plain(resource, ['id', 'sourceKind', 'sourceId', 'title', 'text', 'assetId', 'mime', 'conceptIds', 'manualConceptIds', 'excludedConceptIds', 'analysisStatus', 'analyzedAt', 'updatedAt', 'pages', 'pagination']);
      var resourceId = id(resource.id);
      if (resourceIds.has(resourceId)) fail('Duplicitný zdroj.');
      resourceIds.add(resourceId);
      if (KINDS.indexOf(resource.sourceKind) < 0 || typeof resource.sourceId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(resource.sourceId) || /^(?:https?|data|javascript):/i.test(resource.sourceId)) fail('Neplatný pôvod zdroja.');
      if (MIMES.indexOf(resource.mime) < 0 || ['indexed', 'needs_text', 'error'].indexOf(resource.analysisStatus) < 0) fail('Neplatný typ alebo stav analýzy.');
      var asset = resource.assetId === null ? null : id(resource.assetId), included = links(resource.conceptIds), manual = links(resource.manualConceptIds === undefined ? [] : resource.manualConceptIds), excluded = links(resource.excludedConceptIds);
      if (included.some(function (value) { return excluded.indexOf(value) >= 0; })) fail('Vylúčený pojem nemôže byť prepojený.');
      if (manual.some(function (value) { return excluded.indexOf(value) >= 0 || included.indexOf(value) < 0; })) fail('Ručné prepojenie musí byť medzi priradenými pojmami.');
      var previousPage = 0, pagination = resource.pagination === undefined ? 'unpaginated' : resource.pagination;
      if (pagination !== 'pages' && pagination !== 'unpaginated') fail('Neplatné stránkovanie zdroja.');
      var pages = list(resource.pages === undefined ? [] : resource.pages, 10000).map(function (page) {
        plain(page, ['number', 'text']);
        if (!Number.isSafeInteger(page.number) || page.number <= previousPage || page.number > 100000) fail('Strany musia mať jedinečné rastúce čísla od 1 do 100 000.');
        previousPage = page.number;
        return { number: page.number, text: text(page.text, 200000, false) };
      });
      return { id: resourceId, sourceKind: resource.sourceKind, sourceId: resource.sourceId, title: text(resource.title, 500, false), text: text(resource.text, 200000, false), assetId: asset, mime: resource.mime, conceptIds: included, manualConceptIds: manual, excludedConceptIds: excluded, analysisStatus: resource.analysisStatus, analyzedAt: integer(resource.analyzedAt), updatedAt: integer(resource.updatedAt), pages: pages, pagination: pagination };
    });
    if (new TextEncoder().encode(JSON.stringify(clean)).byteLength > MAX_BYTES) fail('Znalostná mapa presahuje 20 MB.');
    return clean;
  }
  function keywordMatches(keyword, normalized, tokens) {
    var word = normalize(keyword);
    if (!word) return false;
    if ((' ' + normalized + ' ').indexOf(' ' + word + ' ') >= 0) return true;
    var form = FORMS[word];
    return !!form && tokens.some(function (token) { return form.test(token); });
  }
  function matches(concept, normalized, tokens) {
    return [concept.name].concat(concept.keywords || []).some(function (word) { return keywordMatches(word, normalized, tokens); });
  }
  function analyzeResource(resource, concepts) {
    var normalized = normalize((resource.title || '') + '\n' + (resource.text || '')), tokens = normalized.split(' '), next = concepts.map(cloneConcept), existing = new Map();
    next.forEach(function (concept) { existing.set(concept.id, concept); });
    var taxonomyById = new Map(); TAXONOMY.forEach(function (concept) { taxonomyById.set(concept.id, concept); });
    function ensure(concept) {
      if (existing.has(concept.id)) return;
      if (concept.parentId && taxonomyById.has(concept.parentId)) ensure(taxonomyById.get(concept.parentId));
      if (next.length < 2000) { var item = cloneConcept(concept); next.push(item); existing.set(item.id, item); }
    }
    TAXONOMY.forEach(function (concept) { if (matches(concept, normalized, tokens)) ensure(concept); });
    var excluded = new Set(resource.excludedConceptIds || []), linked = new Set(resource.manualConceptIds || []);
    next.forEach(function (concept) { if (!excluded.has(concept.id) && matches(concept, normalized, tokens)) linked.add(concept.id); });
    var status = resource.analysisStatus === 'needs_text' || resource.analysisStatus === 'error' ? resource.analysisStatus : (String(resource.text || '').trim() ? 'indexed' : 'needs_text');
    var result = Object.assign({}, resource, { conceptIds: Array.from(linked).filter(function (value) { return existing.has(value) && !excluded.has(value); }), manualConceptIds: (resource.manualConceptIds || []).filter(function (value) { return existing.has(value) && !excluded.has(value); }), excludedConceptIds: Array.from(excluded).filter(function (value) { return existing.has(value); }), analysisStatus: status, analyzedAt: Date.now() });
    return { resource: result, concepts: next };
  }
  function resourcesUnder(state, conceptId) {
    if (!state.concepts.some(function (concept) { return concept.id === conceptId; })) return [];
    var ids = new Set([conceptId]), previous;
    do { previous = ids.size; state.concepts.forEach(function (concept) { if (ids.has(concept.parentId)) ids.add(concept.id); }); } while (ids.size > previous);
    return state.resources.filter(function (resource) { return resource.conceptIds.some(function (id) { return ids.has(id); }); });
  }
  function mergeCatalog(concepts) {
    var result = concepts.map(cloneConcept), byId = new Map(result.map(function (concept) { return [concept.id, concept]; }));
    var legacyParents = { psychology: null, finance: null, philosophy: null, technology: null, programming: 'technology', 'artificial-intelligence': 'technology' };
    TAXONOMY.forEach(function (item) {
      var existing = byId.get(item.id);
      if (!existing) { existing = cloneConcept(item); result.push(existing); byId.set(existing.id, existing); }
      else if (Object.prototype.hasOwnProperty.call(legacyParents, item.id) && existing.parentId === legacyParents[item.id]) existing.parentId = item.parentId;
      else if (existing.parentId === null && item.parentId !== null) existing.parentId = item.parentId;
    });
    return result;
  }
  return Object.freeze({ createState: createState, validateState: validateState, normalize: normalize, analyzeResource: analyzeResource, resourcesUnder: resourcesUnder, mergeCatalog: mergeCatalog, catalogConcepts: function () { return TAXONOMY.map(cloneConcept); }, sephirot: SEFIROT, loreTerms: LORE_TERMS });
})();
export default KnowledgeModel;
