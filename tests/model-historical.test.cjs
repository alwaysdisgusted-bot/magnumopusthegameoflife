'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../server/game-model.cjs');
const clone = state => JSON.parse(JSON.stringify(state));
const complete = (state, title, total) => M.addBook(state, { title, author: 'Autor', total, current: total, tags: [], cover: '' });

test('historical preview is pure and includes only completed books with uncredited pages',()=>{
  const state=M.createState();complete(state,'Sto strán',100);complete(state,'Štyridsaťpäť strán',45);
  const unfinished=M.addBook(state,{title:'Rozčítaná',total:100,current:50});
  const rewarded=M.addBook(state,{title:'Už zaplatená',total:80});M.readBook(state,rewarded.id,80);
  const before=JSON.stringify(state),preview=M.previewHistoricalReading(state);assert.deepEqual(preview,{books:2,pages:145,earned:7});assert.equal(JSON.stringify(state),before);
  assert.deepEqual(M.claimHistoricalReading(state),preview);assert.equal(M.balance(state),11);assert.equal(state.reading.remainder,5);assert.equal(unfinished.current,50);
  const historical=state.ledger.filter(l=>l.type==='reading-history');assert.equal(historical.length,2);assert.deepEqual(historical.map(l=>l.amount),[100,45]);
  assert.ok(historical.every(l=>l.metric===''&&l.powder===0));assert.deepEqual(M.validateState(state),state);
  const saved=JSON.stringify(state);assert.deepEqual(M.claimHistoricalReading(state),{books:0,pages:0,earned:0});assert.equal(JSON.stringify(state),saved);
});

test('normal reading amounts and previous historical credits are both subtracted before granting',()=>{
  const state=M.createState(),book=M.addBook(state,{title:'Časť už bola odmenená',total:100,current:60});
  M.readBook(state,book.id,100);assert.equal(M.balance(state),2);assert.deepEqual(M.previewHistoricalReading(state),{books:1,pages:60,earned:3});
  M.claimHistoricalReading(state);assert.equal(M.balance(state),5);assert.deepEqual(M.previewHistoricalReading(state),{books:0,pages:0,earned:0});
  const second=M.createState(),extended=complete(second,'Starší čiastočný prevod',40);M.claimHistoricalReading(second);
  extended.total=100;extended.current=100;
  assert.deepEqual(M.validateState(second),second);assert.deepEqual(M.previewHistoricalReading(second),{books:1,pages:60,earned:3});
  M.claimHistoricalReading(second);assert.equal(M.balance(second),5);assert.deepEqual(M.claimHistoricalReading(M.validateState(clone(second))),{books:0,pages:0,earned:0});
});

test('zero-coin historical entries still record pages and carry their remainder across books',()=>{
  const state=M.createState(),active=M.addBook(state,{title:'Nové čítanie',total:200});M.readBook(state,active.id,10);
  const a=complete(state,'Sedem strán',7),b=complete(state,'Osem strán',8);
  assert.deepEqual(M.claimHistoricalReading(state),{books:2,pages:15,earned:1});assert.equal(state.reading.remainder,5);
  assert.deepEqual(state.ledger.filter(l=>l.type==='reading-history').map(l=>[l.ref,l.coins,l.amount]),[[a.id,0,7],[b.id,1,8]]);
  assert.equal(M.metricProgress(state,'reading',M.dateKey()),10);assert.deepEqual(M.validateState(state),state);
});

test('historical grants use the current reading rule and later rule changes cannot grant twice',()=>{
  const state=M.createState();state.reading.threshold=7;state.reading.reward=3;
  const active=M.addBook(state,{title:'Nové strany',total:100});M.readBook(state,active.id,5);complete(state,'Šesť',6);complete(state,'Desať',10);
  assert.deepEqual(M.previewHistoricalReading(state),{books:2,pages:16,earned:9});assert.deepEqual(M.claimHistoricalReading(state),{books:2,pages:16,earned:9});
  assert.equal(state.reading.remainder,0);assert.equal(M.balance(state),9);
  state.reading.threshold=2;state.reading.reward=10;assert.deepEqual(M.claimHistoricalReading(state),{books:0,pages:0,earned:0});assert.deepEqual(M.validateState(state),state);
});

test('historical reading never satisfies today’s challenge while genuine new reading still does',()=>{
  const state=M.createState();complete(state,'Už dávno prečítané',100);M.claimHistoricalReading(state);
  assert.equal(M.metricProgress(state,'reading',M.dateKey()),0);assert.equal(M.powder(state),0);assert.throws(()=>M.claimDaily(state,'reading-20'));
  const active=M.addBook(state,{title:'Dnešná kniha',total:100});M.readBook(state,active.id,20);M.claimDaily(state,'reading-20');
  assert.equal(M.metricProgress(state,'reading',M.dateKey()),20);assert.equal(M.powder(state),1);assert.deepEqual(M.validateState(state),state);
});

test('books can be reopened by changing total pages after a grant without invalidating their history',()=>{
  const state=M.createState(),book=complete(state,'Rozšírené vydanie',100);M.claimHistoricalReading(state);
  M.updateBook(state,book.id,{total:120});assert.deepEqual(M.validateState(state),state);assert.deepEqual(M.previewHistoricalReading(state),{books:0,pages:0,earned:0});
  M.readBook(state,book.id,120);assert.equal(M.balance(state),6);assert.deepEqual(M.claimHistoricalReading(state),{books:0,pages:0,earned:0});assert.deepEqual(M.validateState(state),state);
});

test('historical markers remain idempotent through backup imports and match the browser/server models',async()=>{
  const state=M.createState(),book=complete(state,'Dlhý názov '.padEnd(200,'x'),41);book.notes='Vlastný text\nvrátane poznámok.';
  M.claimHistoricalReading(state);const restored=M.validateState(clone(state));assert.equal(restored.books[0].notes,book.notes);assert.equal(restored.ledger[0].label.length,200);
  assert.deepEqual(M.previewHistoricalReading(restored),{books:0,pages:0,earned:0});assert.deepEqual(M.claimHistoricalReading(restored),{books:0,pages:0,earned:0});
  const server=(await import('../server/game-model.mjs')).default;assert.deepEqual(server.validateState(state),restored);assert.deepEqual(server.previewHistoricalReading(restored),M.previewHistoricalReading(restored));
  const manual=M.createState();complete(manual,'Import dočítanej knihy',100);assert.equal(M.balance(manual),0);assert.equal(manual.ledger.length,0);assert.equal(M.previewHistoricalReading(manual).earned,5);
});

test('historical ledger validation rejects daily metrics, powder, excess pages and missing book references',()=>{
  const state=M.createState();complete(state,'Kontrola denníka',100);M.claimHistoricalReading(state);
  for(const patch of [{metric:'reading'},{powder:1},{coins:-1},{amount:101},{amount:0},{ref:'missing-book'},{type:'history'}]){
    const bad=clone(state);Object.assign(bad.ledger[0],patch);assert.throws(()=>M.validateState(bad),JSON.stringify(patch));
  }
  const combined=M.createState(),book=M.addBook(combined,{title:'Súčet oboch druhov',total:100,current:50});M.readBook(combined,book.id,100);M.claimHistoricalReading(combined);
  const bad=clone(combined);bad.ledger.find(l=>l.type==='reading-history').amount++;assert.throws(()=>M.validateState(bad),/Progres knihy/);
});

test('ledger and wallet capacity checks run before a historical grant can make partial changes',()=>{
  const full=M.createState();full.reading.threshold=100000;
  const active=M.addBook(full,{title:'Vypĺňa denník',total:100000});M.readBook(full,active.id,1);const template=full.ledger[0];
  full.ledger=Array.from({length:29999},(_,i)=>({...template,id:'log-'+i}));active.current=29999;full.reading.remainder=29999;complete(full,'Prvá',1);complete(full,'Druhá',1);
  const before=JSON.stringify(full);assert.throws(()=>M.claimHistoricalReading(full),/Denník je plný/);assert.equal(JSON.stringify(full),before);
  const rich=M.createState(),exercise=M.addExercise(rich,{name:'Hranica mešca',mode:'reps',threshold:1,reward:100000});
  for(let i=0;i<10;i++)M.logExercise(rich,exercise.id,1000000);complete(rich,'Kniha pri plnom mešci',100);
  assert.equal(M.balance(rich),1000000000000);const richBefore=JSON.stringify(rich);assert.throws(()=>M.claimHistoricalReading(rich));assert.equal(JSON.stringify(rich),richBefore);
});

test('optional book notes survive edits and backups while legacy absence remains compatible',()=>{
  const state=M.createState(),book=M.addBook(state,{title:'Poznámky',author:'Autor',total:100,notes:'<script>iba obyčajný text</script>\nMoja myšlienka.',goodreads:{id:'123',isbn:'',shelf:'read',rating:4}});
  M.updateBook(state,book.id,{title:'Nový názov'});assert.equal(book.notes,'<script>iba obyčajný text</script>\nMoja myšlienka.');assert.equal(book.goodreads.id,'123');
  M.updateBook(state,book.id,{notes:'é'.repeat(20000)});assert.equal(M.validateState(clone(state)).books[0].notes.length,20000);
  const before=JSON.stringify(state);for(const notes of ['x'.repeat(20001),{},null,'Nula\u0000v texte']){assert.throws(()=>M.updateBook(state,book.id,{notes}));assert.equal(JSON.stringify(state),before);}
  M.updateBook(state,book.id,{notes:''});assert.equal(book.notes,'');
  const legacy=M.createState();M.addBook(legacy,{title:'Staré uloženie',total:20,current:20});assert.equal('notes' in legacy.books[0],false);assert.deepEqual(M.validateState(clone(legacy)),legacy);
  let invoked=0;const malicious={title:'Getter',total:20};Object.defineProperty(malicious,'notes',{get(){invoked++;return 'bad';},enumerable:true});assert.throws(()=>M.addBook(legacy,malicious));assert.equal(invoked,0);
  const injected=clone(legacy);injected.books[0].notes={__proto__:{polluted:true}};assert.throws(()=>M.validateState(injected));assert.equal({}.polluted,undefined);
});
