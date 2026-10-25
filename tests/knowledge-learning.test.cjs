const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const M=require('../server/game-model.cjs');
const catalog=require('../server/knowledge-catalog.cjs');
const sources=()=>['a','b','c'].map((char,index)=>({id:'source-'+index,name:'Zdroj '+index,sha256:char.repeat(64)}));
const input=(patch={})=>({fieldId:'philosophy-of-science',term:'epistemológia',definition:'Skúmanie povahy a zdôvodnenia poznania.',sources:sources(),expectedRevision:0,...patch});
const clean=state=>M.validateState(structuredClone(state));

test('old saves gain empty learning without changing earned progress; new data roundtrips',()=>{
  const state=M.createState();delete state.learning;
  const before=M.balance(state),copy=clean(state);
  assert.equal(M.balance(copy),before);assert.equal(copy.learning.definitions.length,0);
  assert.equal(M.learningProgress(copy).pillars,10);
  assert.ok(M.learningProgress(copy).total>100);
  assert.equal(M.learningTerms().length,new Set(M.learningTerms().map(item=>M.learningKey(item.fieldId,item.term))).size);
});
test('blank definitions, missing originals, duplicate bytes and unknown terms receive no reward',()=>{
  for(const change of [{definition:' '},{sources:[]},{sources:[sources()[0],sources()[0],sources()[2]]},{sources:sources().map(item=>({...item,sha256:'a'.repeat(64)}))},{sources:sources().map(item=>({...item,sha256:'no hash'}))},{term:'neexistujúci pojem'},{fieldId:'unknown'}]){
    const state=M.createState();assert.throws(()=>M.saveLearningDefinition(state,input(change)));assert.equal(M.balance(state),0);assert.equal(state.learning.definitions.length,0);
  }
});
test('definition pays 30 once, editing is revision checked and never pays again',()=>{
  const state=M.createState();assert.equal(M.saveLearningDefinition(state,input()).earned,30);
  assert.throws(()=>M.saveLearningDefinition(state,input()),/zmenila/);
  const definition=state.learning.definitions[0];
  assert.equal(M.saveLearningDefinition(state,input({definition:'Upravená vlastná definícia.',expectedRevision:1})).earned,0);
  assert.equal(state.learning.definitions[0].id,definition.id);assert.equal(state.learning.definitions[0].revision,2);
  assert.equal(M.balance(clean(state)),30);
});
test('all terms unlock 300 once and gold persists when new custom terms are added',()=>{
  const state=M.createState(),required=M.learningTerms().filter(item=>item.fieldId==='philosophy-of-science');
  for(const term of required)M.saveLearningDefinition(state,input(term));
  assert.equal(M.balance(state),required.length*30+300);
  assert.equal(state.learning.gilded.length,1);assert.equal(state.learning.gilded[0].id,'keter');
  const custom=[{fieldId:'philosophy-of-science',term:'Moja ďalšia terminológia'}];
  const node=M.learningProgress(clean(state),custom).nodes.find(item=>item.id==='keter');
  assert.equal(node.gilded,true);assert.equal(node.definitions,node.total-1);
  assert.equal(M.saveLearningDefinition(state,input({term:custom[0].term}),custom).earned,30);
  assert.equal(state.ledger.filter(item=>item.type==='knowledge-pillar').length,1);clean(state);
});
test('same term has independent definitions in different disciplines and custom terms count',()=>{
  const state=M.createState();
  M.saveLearningDefinition(state,input({fieldId:'research-methods',term:'logika'}));
  M.saveLearningDefinition(state,input({fieldId:'natural-sciences',term:'logika'}));
  assert.equal(state.learning.definitions.length,2);assert.equal(M.balance(clean(state)),60);
  const custom=[{fieldId:'research-methods',term:'Vlastný pojem'}];
  const count=M.learningProgress(state,custom).total;
  assert.equal(count,M.learningProgress(state).total+1);
  M.saveLearningDefinition(state,input(custom[0]),custom);clean(state);
});
test('review uses accumulated ten minutes, exact normalized answer and single-use rewards',()=>{
  const state=M.createState();M.saveLearningDefinition(state,input());
  assert.equal(M.beginLearningReview(state,599999),null);
  const question=M.beginLearningReview(state,600000,()=>0);assert.ok(question);
  assert.equal(M.beginLearningReview(state,1200000).id,question.id,'pending question survives interruption');
  assert.equal(M.answerLearningReview(state,question.id,'  EPISTEMOLOGIA ').earned,3);
  assert.throws(()=>M.answerLearningReview(state,question.id,'epistemológia'));
  assert.equal(M.beginLearningReview(state,1199999),null);
  const next=M.beginLearningReview(state,1200000,()=>0);
  assert.equal(M.answerLearningReview(state,next.id,'epistemo').earned,0);
  assert.equal(M.balance(clean(state)),33);
  assert.equal(state.learning.reviews.length,2);
});
test('save validator rejects forged duplicate, missing and incorrect rewards and incomplete gold',async()=>{
  const state=M.createState();M.saveLearningDefinition(state,input());
  const duplicate=structuredClone(state);duplicate.ledger.push({...duplicate.ledger[0],id:'different-ledger-id'});assert.throws(()=>clean(duplicate));
  const missing=structuredClone(state);missing.ledger=[];assert.throws(()=>clean(missing));
  const wrong=structuredClone(state);wrong.ledger[0].coins=300;assert.throws(()=>clean(wrong));
  const gold=structuredClone(state);gold.learning.gilded=[{id:'keter',definitionIds:[gold.learning.definitions[0].id]}];assert.throws(()=>clean(gold));
  const untimed=structuredClone(state);M.beginLearningReview(untimed,600000,()=>0);untimed.learning.lastReviewActiveMs=0;assert.throws(()=>clean(untimed));
  const esm=(await import('../server/game-model.mjs')).default;
  assert.deepEqual(esm.validateState(state),clean(state));
});
test('live bridge resolves actual uploaded blobs and rejects renamed copies without touching personal data',async()=>{
  let state=M.createState(),saveCalls=0;
  const docs=['one','two','three'].map((text,index)=>({id:'doc-'+index,name:'Podklad '+index,blob:new Blob([text])}));
  const window={MOKnowledgeCatalog:catalog,MOApp:{model:M,get state(){return state;},esc:String,toast(){},commit(mutator,message,options){assert.equal(options.preserveView,true,'saving must preserve the iframe and unfinished notes');const draft=structuredClone(state);const result=mutator(draft);state=clean(draft);return{result};}},MOAuth:{isAuthenticated:()=>true,saveNow:async()=>{saveCalls++;}},MOKnowledgeStore:{getDocuments:async()=>docs,getValue:async()=>({future:{archive:[{term:'Imported future term'}]}})}};
  const document={body:{classList:{contains:()=>false}},addEventListener(){}};
  vm.compileFunction(fs.readFileSync('public/learning.js','utf8'),['window','document','crypto','navigator','setInterval','localStorage','structuredClone'])(window,document,webcrypto,{},()=>{},null,structuredClone);
  const submit={fieldId:'philosophy-of-science',term:'epistemológia',definition:'Moje vysvetlenie.',sourceIds:['doc-0','doc-1','doc-2'],expectedRevision:0};
  docs[2].blob=docs[0].blob;
  await assert.rejects(()=>window.MOLearning.saveDefinition(submit),/rôzne originály/);assert.equal(M.balance(state),0);
  docs[2].blob=new Blob(['three']);
  const result=await window.MOLearning.saveDefinition(submit);
  assert.equal(result.earned,30);assert.equal(saveCalls,1);assert.equal(M.balance(state),30);
  assert.equal(result.definitions[0].sources[0].sha256.length,64);
  docs[1].blob=null;
  await assert.rejects(()=>window.MOLearning.saveDefinition({...submit,expectedRevision:1}),/originál/);
  docs[1].blob=new Blob(['two']);
  window.MOAuth.saveNow=async()=>{throw Error('Spojenie vypadlo.');};
  await assert.rejects(()=>window.MOLearning.saveDefinition({...submit,expectedRevision:1}),error=>error.definitionRevision===2&&/miestnom koncepte/.test(error.message));
  assert.equal(M.balance(state),30,'an unsaved retry cannot pay again');
  window.MOAuth.saveNow=async()=>{};
  assert.equal((await window.MOLearning.saveDefinition({...submit,expectedRevision:2})).earned,0);
});
