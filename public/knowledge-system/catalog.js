(function (root, factory) {
  'use strict';
  const catalog = factory();
  if (typeof module === 'object' && module.exports) module.exports = catalog;
  else root.MOKnowledgeCatalog = catalog;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
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

for (const field of fields) {
  const known = new Set(field.categories.flatMap(category => category.terms));
  const missing = field.terms.filter(term => !known.has(term));
  if (missing.length) field.categories.push({id:'field-overview',name:'Ďalšie pojmy odboru',terms:missing,authors:[]});
}
return {sefirot,fields};
});
