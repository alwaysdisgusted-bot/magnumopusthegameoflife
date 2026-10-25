const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function catalog(){const window={};const ctx=vm.createContext({window});for(const file of ['quotes-data.js','quote-authors.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../public',file),'utf8'),ctx);return window;}

test('expanded quotes preserve all old ids and add 24 source-linked classical readings',()=>{
  const w=catalog(),list=w.MOQuoteCatalog;
  assert.equal(list.length,46);assert.equal(new Set(list.map(q=>q.id)).size,46);
  for(let i=1;i<=7;i++)assert.ok(list.find(q=>q.id==='text-'+i));
  for(let i=1;i<=15;i++)assert.ok(list.find(q=>q.id==='scan-'+i));
  for(let i=1;i<=24;i++){
    const q=list.find(q=>q.id==='classic-'+i);
    assert.ok(q);assert.ok(q.sourceURL.startsWith('https://'));
    assert.match(q.sourceNote,/voľné slovenské znenie/);assert.equal(q.verification,'verified');
    assert.ok(w.MOQuoteAuthors.authors.some(a=>a.id===q.authorId));
  }
});

test('classical readings identify the audited work and exact section',()=>{
  const w=catalog(),expected=[
    ['aristotle','nicomachean-ethics',['II.1','II.1','II.1','II.2']],
    ['marcus','meditations',['IV.2','IV.3','IV.17','IV.20']],
    ['epictetus','enchiridion',['1','5','8','10']],
    ['epicurus','letter-to-menoeceus',['122','127','126','127']],
    ['seneca','moral-letters',['1.3','1.2','1.2','1.3']],
    ['spinoza','ethics',['III.6','IV.67','V.6','V.42']]
  ];
  let count=0;
  for(const [authorId,workId,sections] of expected)for(const section of sections){
    const id='classic-'+(++count),q=w.MOQuoteCatalog.find(q=>q.id===id);
    assert.equal(q.authorId,authorId);assert.equal(q.workId,workId);assert.equal(q.section,section);
  }
  assert.match(w.MOQuoteCatalog.find(q=>q.id==='classic-15').text,/prežije najpríjemnejšie/);
});

test('author grouping uses recognized attribution and keeps uncertain passages in the original collection',()=>{
  const w=catalog(),a=w.MOQuoteAuthors;
  assert.equal(a.authors.length,13);
  for(const id of ['aristotle','marcus','epictetus','epicurus','seneca','spinoza','liptak','horace','lucretius','camus','fisher','brown','original'])assert.equal(a.of({authorId:id}),id);
  for(const [id,authorId] of [['text-1','liptak'],['text-3','horace'],['text-7','spinoza'],['scan-6','epicurus'],['scan-8','lucretius'],['scan-9','camus'],['scan-14','fisher'],['scan-15','brown']])assert.equal(a.of(w.MOQuoteCatalog.find(q=>q.id===id)),authorId,id);
  assert.equal(a.of({id:'text-1',author:'Aristoteles'}),'original');
  assert.notEqual(a.of(w.MOQuoteCatalog.find(q=>q.id==='text-1')),'aristotle');
  assert.equal(a.of({id:'text-7',author:'Spinoza'}),'original');
  assert.equal(a.of({authorId:'unverified-author'}),'original');
  assert.equal(a.of({}),'original');
});

test('all 13 author groups provide distinct native artwork and unknown IDs use the original artwork',()=>{
  const a=catalog().MOQuoteAuthors,busts=a.authors.map(author=>a.bust(author.id));
  assert.equal(new Set(busts).size,13);
  for(const svg of busts){assert.match(svg,/<svg/);assert.doesNotMatch(svg,/<script|onload|https?:|<image/);}
  assert.equal(a.bust('unknown-author'),a.bust('original'));
  assert.equal(a.bust(),a.bust('original'));
  for(const id of ['liptak','horace','lucretius','camus','fisher','brown'])assert.match(a.bust(id),/Symbolická busta/);
});
