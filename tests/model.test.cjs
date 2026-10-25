'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../server/game-model.cjs');
const roundtrip = state => M.validateState(JSON.parse(JSON.stringify(state)));

test('Čítanie odmeňuje len nové strany, prenáša zvyšok a neodmeňuje pridaný historický progres', () => {
  const s = M.createState();
  const a = M.addBook(s, {title:'A', author:'Autor', total:100, current:30, tags:['Učenie']});
  const b = M.addBook(s, {title:'B', total:100});
  assert.equal(M.balance(s),0);
  assert.deepEqual(M.readBook(s,a.id,39), {earned:0,amount:9});
  assert.deepEqual(M.readBook(s,b.id,11), {earned:1,amount:11});
  assert.equal(s.reading.remainder,0);
  const before=s.ledger.length;
  assert.deepEqual(M.readBook(s,b.id,11), {earned:0,amount:0});
  assert.equal(s.ledger.length,before);
  assert.throws(()=>M.readBook(s,a.id,38));
  assert.throws(()=>M.updateBook(s,a.id,{current:40}));
  M.updateBook(s,a.id,{title:'Nový názov',tags:['Práca','Život']});
  assert.equal(a.current,39);
  assert.deepEqual(roundtrip(s),s);
});

test('Posilňovňa podporuje vlastnú sadzbu, splnenia a bezpečnú zmenu pravidiel', () => {
  const s=M.createState();
  const e=M.addExercise(s,{name:'Drepy',mode:'reps',threshold:5,reward:3});
  assert.equal(M.logExercise(s,e.id,12).earned,6);
  assert.equal(e.remainder,2);
  M.updateExercise(s,e.id,{name:'Drepy s vlastnou váhou'});
  assert.equal(e.remainder,2);
  M.updateExercise(s,e.id,{threshold:10,reward:2});
  assert.equal(e.remainder,0);
  assert.equal(e.total,12);
  assert.equal(M.balance(s),6);
  assert.equal(M.logExercise(s,e.id,10).earned,2);
  M.updateExercise(s,e.id,{mode:'completion',reward:4});
  assert.equal(e.threshold,1);
  assert.equal(M.logExercise(s,e.id,1).earned,4);
  assert.throws(()=>M.logExercise(s,e.id,2));
  assert.equal(e.total,23);
  assert.equal(e.completions,4);
  assert.equal(M.balance(s),12);
  assert.deepEqual(roundtrip(s),s);
});

test('Meditácia prenáša minúty; nákup nemôže minúť viac korún ani kúpiť položku dvakrát', () => {
  const s=M.createState();
  assert.throws(()=>M.buy(s,'rose'));
  assert.throws(()=>M.equip(s,'rose'));
  assert.deepEqual(M.meditate(s,24), {earned:0,amount:24});
  assert.deepEqual(M.meditate(s,1), {earned:1,amount:1});
  M.logExercise(s,s.exercises[0].id,200);
  M.buy(s,'rose');
  M.equip(s,'rose');
  M.buy(s,'cat');
  assert.equal(M.balance(s),1);
  assert.equal(s.profile.equipped,'rose');
  assert.deepEqual(s.animals,['cat']);
  const before=JSON.stringify(s);
  assert.throws(()=>M.buy(s,'cat'));
  assert.throws(()=>M.buy(s,'midnight'));
  assert.throws(()=>M.equip(s,'cat'));
  assert.equal(JSON.stringify(s),before);
  assert.deepEqual(roundtrip(s),s);
});

test('Projekt a denná výzva dávajú odmenu iba raz; výzva vyžaduje dnešnú aktivitu', () => {
  const s=M.createState();
  const p=M.addProject(s,'Môj obraz');
  M.finishProject(s,p.id);
  assert.throws(()=>M.finishProject(s,p.id));
  const b=M.addBook(s,{title:'Čítanie',total:200});
  assert.throws(()=>M.claimDaily(s,'reading-20',M.dateKey()));
  M.readBook(s,b.id,20);
  M.claimDaily(s,'reading-20',M.dateKey());
  assert.equal(M.powder(s),1);
  assert.equal(M.balance(s),2);
  assert.throws(()=>M.claimDaily(s,'reading-20',M.dateKey()));
  assert.throws(()=>M.claimDaily(s,'exercise-10','2000-01-01'));
  M.logExercise(s,s.exercises[0].id,10);
  M.claimDaily(s,'exercise-10',M.dateKey());
  M.meditate(s,25);
  M.claimDaily(s,'meditation-25',M.dateKey());
  assert.equal(M.powder(s),3);
  assert.deepEqual(roundtrip(s),s);
});

test('Záloha je úplná nezávislá kópia a obsahuje banku, nastavenia aj stratégie', () => {
  const s=M.createState();
  s.bank.card=123.45;
  s.bank.cash=30;
  s.strategies.push({id:'plan-1',title:'Rezerva',target:3000,monthly:100,deadline:'2027-01-01',notes:'Odkladať 10 % príjmu.'});
  s.settings.calendarUrl='https://example.com/calendar';
  const b=M.addBook(s,{title:'Obálka',total:100,tags:['Myseľ'],cover:'data:image/png;base64,aGVsbG8='});
  const copy=roundtrip(s);
  copy.books[0].tags.push('Nový');
  copy.bank.card=0;
  assert.equal(s.bank.card,123.45);
  assert.deepEqual(b.tags,['Myseľ']);
  assert.equal(M.dateKey('2026-10-17T22:30:00Z'),'2026-10-18');
  assert.equal(M.dateKey('2026-01-17T22:30:00Z'),'2026-01-17');
});

test('Validácia odmieta poškodené, nebezpečné a nekonzistentné zálohy', () => {
  const cases=[
    s=>{s.version=2;},
    s=>{s.bank.card=Infinity;},
    s=>{s.bank.cash=-1;},
    s=>{s.exercises[0].threshold=0;},
    s=>{s.exercises[0].total=4;},
    s=>{s.wardrobe.push('rose');},
    s=>{s.animals.push('classic');},
    s=>{s.profile.equipped='rose';},
    s=>{s.settings.calendarUrl='javascript:alert(1)';},
    s=>{s.dailyClaims['2026-02-30']=['reading-20'];},
    s=>{s.dailyClaims[M.dateKey()]=['reading-20'];},
    s=>{s.extra='unexpected';},
    s=>{s.books.push({id:'book-x',title:'X',author:'',total:5,current:10,tags:[],cover:''});},
    s=>{s.books.push({id:'book-x',title:'X',author:'',total:5,current:0,tags:[],cover:'data:image/svg+xml;base64,PHN2Zz4='});},
    s=>{s.exercises.push({...s.exercises[0]});},
    s=>{s.books=new Array(2);},
    s=>{Object.defineProperty(s.profile,'name',{get(){throw new Error('Accessor executed');}});}
  ];
  for(const change of cases){const s=M.createState();change(s);assert.throws(()=>M.validateState(s));}
  const injected=JSON.parse(JSON.stringify(M.createState()).replace('"profile":{','"profile":{"__proto__":{"polluted":true},'));
  assert.throws(()=>M.validateState(injected));
  assert.equal({}.polluted,undefined);
  const s=M.createState();
  M.meditate(s,25);
  s.ledger[0].dateKey='2020-01-01';
  assert.throws(()=>M.validateState(s));
  const negative=M.createState();
  M.logExercise(negative,negative.exercises[0].id,200);
  M.buy(negative,'rose');
  negative.ledger.reverse();
  assert.throws(()=>M.validateState(negative));
});

test('Neplatné vstupy nesmú vytvoriť odmeny ani zmeniť stav', () => {
  const s=M.createState();
  const b=M.addBook(s,{title:'X',total:10});
  for(const value of [-1,1.5,Infinity,NaN,'10',11]){
    const before=JSON.stringify(s);
    assert.throws(()=>M.readBook(s,b.id,value));
    assert.equal(JSON.stringify(s),before);
  }
  for(const value of [0,-1,1.5,Infinity,NaN,'10']){
    const before=JSON.stringify(s);
    assert.throws(()=>M.logExercise(s,s.exercises[0].id,value));
    assert.throws(()=>M.meditate(s,value));
    assert.equal(JSON.stringify(s),before);
  }
});
