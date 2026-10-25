(() => {
  'use strict';
  const authors=[
    {id:'aristotle',name:'Aristoteles',theme:'Návyky a dobrý život',accent:'#d9ae54'},
    {id:'marcus',name:'Marcus Aurelius',theme:'Vnútorný pokoj a konanie',accent:'#94b3c7'},
    {id:'epictetus',name:'Epiktétos',theme:'Sloboda a vlastné rozhodnutia',accent:'#a8bc8b'},
    {id:'epicurus',name:'Epikuros',theme:'Jednoduchosť a spokojnosť',accent:'#d09ea9'},
    {id:'seneca',name:'Seneca',theme:'Čas a pozorný život',accent:'#c7a57a'},
    {id:'spinoza',name:'Baruch Spinoza',theme:'Rozum a porozumenie',accent:'#b0a1d1'},
    {id:'liptak',name:'Marián Lipták',theme:'Výklad filozofie a slobody',accent:'#a7b8a6'},
    {id:'horace',name:'Horatius',theme:'Miera, túžby a každodenný život',accent:'#d4b27d'},
    {id:'lucretius',name:'Titus Lucretius Carus',theme:'Príroda a život bez strachu',accent:'#a9c4b9'},
    {id:'camus',name:'Albert Camus',theme:'Absurdno a vedomý život',accent:'#9bb1ca'},
    {id:'fisher',name:'Mark Fisher',theme:'Spoločnosť a predstavivosť',accent:'#c29f9b'},
    {id:'brown',name:'Wendy Brown',theme:'Sloboda a politická moc',accent:'#baa4c5'},
    {id:'original',name:'Tvoja pôvodná zbierka',theme:'Osobné zápisy a neurčené autorstvo',accent:'#8da9a1'}
  ];
  const source={aristotle:['https://classics.mit.edu/Aristotle/nicomachaen.2.ii.html','Etika Nikomachova, kniha II'],marcus:['https://classics.mit.edu/Antoninus/meditations.4.four.html','Hovory k sebe, kniha IV'],epictetus:['https://classics.mit.edu/Epictetus/epicench.html','Rukoväť, oddiely 1, 5, 8 a 10'],epicurus:['https://classics.mit.edu/Epicurus/menoec.html','List Menoikeovi'],seneca:['https://constitutioncenter.org/the-constitution/historic-document-library/detail/seneca-moral-letters-to-luciliuson-saving-time-ca-65','Listy Luciliovi, list 1'],spinoza:['https://www.gutenberg.org/files/3800/3800-h/3800-h.htm','Etika: III.6, IV.67, V.6 a V.42']};
  const locations={
    aristotle:{workId:'nicomachean-ethics',sections:['II.1','II.1','II.1','II.2']},
    marcus:{workId:'meditations',sections:['IV.2','IV.3','IV.17','IV.20']},
    epictetus:{workId:'enchiridion',sections:['1','5','8','10']},
    epicurus:{workId:'letter-to-menoeceus',sections:['122','127','126','127']},
    seneca:{workId:'moral-letters',sections:['1.3','1.2','1.2','1.3']},
    spinoza:{workId:'ethics',sections:['III.6','IV.67','V.6','V.42']}
  };
  const texts={
    aristotle:['Veci, ktoré sa musíme naučiť robiť, sa učíme tým, že ich robíme.','Spravodlivými sa stávame spravodlivým konaním.','Na tom, aké návyky si osvojíme od mladosti, záleží nesmierne veľa.','Cieľom skúmania nie je iba vedieť, čo je cnosť, ale stať sa dobrými.'],
    marcus:['Nerob žiadny čin bez cieľa.','Kedykoľvek sa môžeš stiahnuť do vlastného vnútra a obnoviť sa.','Kým žiješ a je to v tvojej moci, buď dobrý.','To, čo je skutočne krásne, nepotrebuje pochvalu.'],
    epictetus:['Niektoré veci sú v našej moci, iné nie.','Ľudí neznepokojujú veci, ale názory, ktoré si o nich vytvárajú.','Nežiadaj, aby sa veci diali podľa tvojich prianí. Praj si, aby sa diali tak, ako sa dejú.','Pri každej udalosti sa pýtaj, akú schopnosť máš na jej zvládnutie.'],
    epicurus:['Pre zdravie duše nie je nikdy priskoro ani neskoro.','Budúcnosť nie je celkom naša, ani celkom mimo nás.','Múdry človek si nevyberá najdlhší život, ale ten, ktorý prežije najpríjemnejšie.','Medzi túžbami rozlišuj prirodzené a tie, ktoré sú márne.'],
    seneca:['Nič nám nepatrí, iba čas.','Chyť sa dnešnej úlohy a budeš menej závislý od zajtrajška.','Zatiaľ čo život odkladáme, život plynie ďalej.','Čas je pôžička, ktorú nedokáže vrátiť ani vďačný človek.'],
    spinoza:['Každá vec sa podľa svojej sily usiluje zotrvať vo svojom bytí.','Múdrosť slobodného človeka je rozjímaním o živote, nie o smrti.','Myseľ má väčšiu moc nad emóciami, keď rozumie nevyhnutnosti vecí.','Blaženosť nie je odmenou za cnosť, ale cnosťou samotnou.']
  };
  let count=0;
  authors.filter(a=>texts[a.id]).forEach(a=>texts[a.id].forEach((text,index)=>window.MOQuoteCatalog.push({id:'classic-'+(++count),text,author:a.name,authorId:a.id,workId:locations[a.id].workId,section:locations[a.id].sections[index],verification:'verified',sourceNote:source[a.id][1]+', '+locations[a.id].sections[index]+'. Vlastné voľné slovenské znenie podľa uvedeného textu; nejde o citáciu slovenského vydania.',sourceURL:source[a.id][0]})));
  function of(q){return authors.some(a=>a.id===q.authorId)?q.authorId:'original';}
  const symbolicBusts={
    liptak:{initials:'ML',hair:'M50 57Q43 28 66 23Q95 13 111 43L105 55L97 37L58 43Z',clothes:'M56 116L80 132L105 116L128 137L137 153H23L33 136Z',glasses:true},
    horace:{initials:'QH',hair:'M49 58Q42 35 58 25Q78 13 98 24L112 42L106 58L99 39L84 43L70 35L57 46Z',clothes:'M59 114Q34 122 25 150H137L117 126L101 115L85 143Z',laurel:true},
    lucretius:{initials:'LC',hair:'M49 61L42 48L48 35L45 25L64 28L77 17L88 27L104 23L111 38L116 48L107 60L98 38L80 43L62 37Z',clothes:'M59 114L28 133L20 152H139L123 129L100 114L63 149L47 136Z',beard:true},
    camus:{initials:'AC',hair:'M48 56Q43 26 66 22Q93 12 111 35L109 50L97 37L55 42Z',clothes:'M58 114L80 133L102 114L125 130L138 152H22L35 130Z',collar:true},
    fisher:{initials:'MF',hair:'M47 62Q38 38 53 27L66 18L77 26L92 19L109 30L115 52L108 65L99 40L89 45L74 35L56 45Z',clothes:'M58 114L42 123L24 153H137L119 126L101 114Q80 140 58 114Z',glasses:true},
    brown:{initials:'WB',hair:'M45 99Q33 69 44 42Q51 16 81 20Q112 14 121 45L118 113L104 124L102 57L86 34L57 52L58 117Z',clothes:'M61 114Q42 119 32 134L22 152H138L128 132Q112 119 99 114L80 136Z',necklace:true}
  };
  function symbolicBust(a,shape){
    const details=(shape.glasses?'<path d="M55 66h21v12H55Zm30 0h21v12H85ZM76 70h9" fill="none" stroke="#6f827b" stroke-width="3"/>':'')+(shape.laurel?'<path d="M45 48Q51 20 79 17Q105 20 115 45M49 38l-3-11 11 5M60 26l1-11 9 7M99 28l-1-12-8 7M110 39l5-9-10 3" fill="none" stroke="#c2bd93" stroke-width="3"/>':'')+(shape.beard?'<path d="M54 85Q80 98 107 85L99 108L80 123L61 109Z" fill="#acb8a9"/><path d="M63 99l7 11M80 101v13M97 98l-7 13" stroke="#dfe2ce" stroke-width="3"/>':'')+(shape.collar?'<path d="M58 117L74 143L80 133L87 143L102 117M80 134v17" fill="none" stroke="#e3e5d2" stroke-width="4"/>':'')+(shape.necklace?'<path d="M60 122Q80 155 101 122" fill="none" stroke="#e3dfc9" stroke-width="3"/><circle cx="80" cy="143" r="4" fill="#e3dfc9"/>':'');
    return `<svg viewBox="0 0 160 180" aria-hidden="true"><title>Symbolická busta — ${a.name}</title><ellipse cx="80" cy="158" rx="63" ry="10" fill="#071e2855"/><path d="M63 99L59 119L81 139L101 118L96 99Z" fill="#b7c1ae"/><path d="${shape.clothes}" fill="#c6cdb9" stroke="#8f9e91" stroke-width="2"/><path d="M50 52Q49 25 79 24Q109 23 111 54L107 89Q102 111 80 118Q57 112 52 89Z" fill="#d9ddc9" stroke="#9ca999" stroke-width="2"/><path d="${shape.hair}" fill="#91a192"/><path d="M59 63q8-4 15 0m13 0q8-4 15 0M63 71h8m19 0h8M81 70l-4 18h9M68 98q12 5 24-1" fill="none" stroke="#829585" stroke-width="2" stroke-linecap="round"/>${details}<path d="M27 151h106v13H27Z" fill="#9daa9a"/><path d="M21 164h118v12H21Z" fill="#ced2b9"/><path d="M31 155h98" stroke="${a.accent}" stroke-width="3"/><text x="80" y="173" text-anchor="middle" font-family="Georgia,serif" font-size="9" font-weight="bold" letter-spacing="2" fill="#53695c">${shape.initials}</text></svg>`;
  }
  function bust(id){const a=authors.find(a=>a.id===id)||authors.find(a=>a.id==='original');id=a.id;if(id==='original')return `<svg viewBox="0 0 160 180" aria-hidden="true"><path d="M30 40Q55 30 80 43Q105 30 130 40V125Q103 118 80 133Q55 118 30 125Z" fill="#e0d6b9" stroke="#867f6b" stroke-width="3"/><path d="M80 43V133M42 57l27 5M42 73l27 5M92 62l26-5M92 78l26-5" fill="none" stroke="#9a8d71" stroke-width="2"/><path d="M18 147h124v17H18Z" fill="#b9ad8e"/><path d="M24 145h112" stroke="${a.accent}" stroke-width="3"/></svg>`;
    if(symbolicBusts[id])return symbolicBust(a,symbolicBusts[id]);
    const longBeard=['aristotle','epicurus','epictetus'].includes(id),hair=id==='spinoza'?'<path d="M47 57Q35 23 69 20Q106 11 116 55L124 108L107 124L101 73L58 71L53 124L35 112Z" fill="#747b78"/><path d="M44 56q-9 14 0 25q-13 17 0 31M113 50q13 17 0 32q14 18 1 31" fill="none" stroke="#b2b5a8" stroke-width="5"/>':id==='seneca'||id==='epictetus'?'<path d="M48 60Q46 32 61 24M111 60Q113 33 98 26" fill="none" stroke="#b3b3a2" stroke-width="9"/>':'<path d="M47 62Q36 38 52 25Q76 7 105 26Q123 39 112 63L102 43Q82 55 58 42Z" fill="#a4aa9c"/><path d="M50 40q9-14 18-3q10-16 20-3q12-13 21 4" fill="none" stroke="#d4d5c0" stroke-width="5"/>';
    const beard=longBeard?'<path d="M52 81Q64 92 80 88Q97 92 108 81L104 110L80 132L56 111Z" fill="#acb2a1"/><path d="M62 97l7 18m10-18v25m11-25-4 18m11-20-3 11" stroke="#dedfca" stroke-width="3" stroke-linecap="round"/>':id==='marcus'?'<path d="M51 82Q64 90 80 88Q97 89 109 82L105 107Q80 129 55 107Z" fill="#a6ad9f"/><path d="M62 98q18 13 36 0" fill="none" stroke="#d9dbc7" stroke-width="3"/>':'<path d="M64 100q15 8 29-1" fill="none" stroke="#a2a798" stroke-width="2"/>';
    return `<svg viewBox="0 0 160 180" aria-hidden="true"><ellipse cx="80" cy="158" rx="64" ry="10" fill="#071e2855"/><path d="M65 100L61 118L27 132L18 151H142L133 132L99 118L96 100" fill="#c3c9b6" stroke="#8f9e91" stroke-width="2"/><path d="M30 135l25 13m75-13-25 13M57 120l22 26 24-26" fill="none" stroke="#e2e4d0" stroke-width="4"/><path d="M49 52Q48 19 80 21Q112 20 112 55L109 89Q104 112 80 118Q55 112 51 89Z" fill="#d9ddc9" stroke="#9ca999" stroke-width="2"/>${hair}<path d="M59 66q9-5 16 0m12 0q8-5 16 0" fill="none" stroke="#8e9c8f" stroke-width="3" stroke-linecap="round"/><path d="M64 70h8m18 0h8M82 69l-5 19h10M68 96q12 4 24-1" fill="none" stroke="#8a998a" stroke-width="2" stroke-linecap="round"/>${beard}${id==='marcus'?'<path d="M48 44Q77 20 111 43" fill="none" stroke="#a6a37c" stroke-width="3"/><path d="M51 40l1-10 10 5m2-4 4-10 8 6m22 7 2-10-10 2m18 13 6-8-10-2" fill="none" stroke="#c7c39a" stroke-width="4"/>':''}${id==='spinoza'?'<path d="M59 117L80 133L102 117L114 130L87 141L80 133L72 141L46 130Z" fill="#e9e9d7"/>':''}<path d="M27 151h106v13H27Z" fill="#9daa9a"/><path d="M21 164h118v8H21Z" fill="#ced2b9"/><path d="M31 155h98" stroke="${a.accent}" stroke-width="3"/></svg>`;
  }
  window.MOQuoteAuthors={authors,of,bust};
})();
