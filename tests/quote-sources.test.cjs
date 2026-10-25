/* eslint-disable @typescript-eslint/no-require-imports -- This test follows the existing CommonJS test runner. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function sources(){
  const window={};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/quote-sources.js'),'utf8'),{window,URL});
  return window.MOQuoteSources;
}
function ids(books){return Array.from(books,book=>book.id);}

test('library matching requires verified attribution and both author and exact work identity',()=>{
  const S=sources(),q={verification:'verified',workId:'ethics'};
  const books=[
    {id:'yes',title:'Etika',author:'Baruch Spinoza'},
    {id:'wrong-author',title:'Etika',author:'Aristoteles'},
    {id:'wrong-work',title:'Tractatus Theologico-Politicus',author:'Baruch Spinoza'},
    {id:'prefix',title:'Ethics and Politics',author:'Spinoza'},
    {id:'suffix',title:'EthicsXYZ',author:'Spinoza'},
    {id:'coauthors',title:'Ethics',author:'Baruch Spinoza, Jane Smith'},
    {id:'family-substring',title:'Ethics',author:'Joseph Spinoza'}
  ];
  assert.deepEqual(ids(S.matchingBooks(q,books)),['yes']);
  assert.equal(S.matchingBooks({...q,verification:'unverified'},books).length,0);
  assert.equal(S.matchingBooks({workId:'ethics'},books).length,0);
  assert.equal(S.matchingBooks(q,null).length,0);
  assert.equal(S.matchingBooks({...q,workId:'toString'},books).length,0);
});

test('accent folding, listed name variants and delimited subtitles preserve correct book links',()=>{
  const S=sources();
  assert.deepEqual(ids(S.matchingBooks({verification:'verified',workId:'meditations'},[
    {id:'cz',title:'HOVORY K SOBĚ',author:'Marcus Aurelius'},
    {id:'subtitle',title:'Meditations: A New Translation',author:'Aurelius, Marcus'},
    {id:'dash',title:'The Meditations — New Edition',author:'Marcus Aurelius'},
    {id:'different',title:'Meditations and Other Writings',author:'Marcus Aurelius'}
  ])),['cz','subtitle','dash']);
  assert.deepEqual(ids(S.matchingBooks({verification:'verified',workId:'nicomachean-ethics'},[
    {id:'sk',title:'Etika Níkomachova',author:'ARISTOTELES'}
  ])),['sk']);
});

test('selected Seneca and distinct Epictetus works never become automatic aliases',()=>{
  const S=sources();
  assert.equal(S.matchingBooks({verification:'verified',workId:'moral-letters'},[{id:'selection',title:'Letters from a Stoic',author:'Seneca'}]).length,0);
  assert.equal(S.matchingBooks({verification:'verified',workId:'enchiridion'},[{id:'discourses',title:'Discourses',author:'Epictetus'}]).length,0);
  assert.equal(S.matchingBooks({verification:'verified',workId:'dynamic-evolution'},[{id:'article',title:'Dynamic Evolution',author:''}]).length,0);
});

test('default and public markup contain source information without exposing private library data',()=>{
  const S=sources(),q={verification:'verified',workId:'ethics',sourceSection:'III.6'},books=[{id:'private-123',title:'Etika: My Secret Edition',author:'Spinoza',notes:'private notes'}];
  const publicMarkup=S.workMarkup(q,{books});
  assert.match(publicMarkup,/Etika/);
  assert.match(publicMarkup,/III\.6/);
  assert.match(publicMarkup,/https:\/\/www\.gutenberg\.org/);
  assert.doesNotMatch(publicMarkup,/private-123|My Secret Edition|private notes|book-detail/);
  assert.equal(S.workMarkup(q),publicMarkup);
  const privateMarkup=S.workMarkup(q,{books,linkBooks:true});
  assert.match(privateMarkup,/data-action="book-detail" data-id="private-123"/);
  assert.match(privateMarkup,/My Secret Edition/);
  assert.doesNotMatch(privateMarkup,/private notes/);
});

test('possible sources remain inspectable without book matching and related works have their own identity',()=>{
  const S=sources(),books=[{id:'fisher',title:'Capitalist Realism: Is There No Alternative?',author:'Mark Fisher'},{id:'epicurus',title:'List Menoikeovi',author:'Epikuros'}];
  const q={verification:'unverified',workId:'letter-to-menoeceus',sourceSection:'127',relatedWorkId:'capitalist-realism',relatedVerification:'verified',relatedSection:'kapitola 6'};
  const markup=S.workMarkup(q,{books,linkBooks:true});
  assert.match(markup,/Možný prameň/);
  assert.match(markup,/Citované v/);
  assert.match(markup,/data-id="fisher"/);
  assert.doesNotMatch(markup,/data-id="epicurus"/);
  assert.match(markup,/href="https:\/\/classics\.mit\.edu\/Epicurus/);
  assert.match(markup,/kapitola 6/);
  const unverified=S.workMarkup({workId:'ethics',sourceURL:'https://example.test/'},{books:[{id:'s',title:'Ethics',author:'Spinoza'}],linkBooks:true});
  assert.match(unverified,/Možný prameň/);
  assert.match(unverified,/href="https:\/\/example\.test\/"/);
  assert.doesNotMatch(unverified,/book-detail/);
  assert.doesNotMatch(S.workMarkup({workId:'ethics',sourceURL:'javascript:alert(1)'}),/<a/);
});

test('HTML is escaped in sections and private book labels and identifiers',()=>{
  const S=sources();
  const markup=S.workMarkup({verification:'verified',workId:'ethics',sourceSection:'<script>alert("section")</script>'},{books:[{id:'x" onclick="alert(1)',title:'Ethics: <img src=x onerror=alert(1)>',author:'Spinoza'}],linkBooks:true});
  assert.doesNotMatch(markup,/<script|<img|data-id="x" onclick=/);
  assert.match(markup,/&lt;script&gt;/);
  assert.match(markup,/data-id="x&quot; onclick=&quot;alert\(1\)"/);
  assert.match(markup,/Ethics: &lt;img/);
});

test('source links reject executable, relative, malformed and credential-bearing URLs',()=>{
  const S=sources();
  for(const sourceURL of ['javascript:alert(1)','data:text/html,<script>','http://example.test/','//example.test/','https://user:secret@example.test/','https://exa mple.test/','https://example.test/\nonclick=bad','https://example.test\\evil','https://']){
    const markup=S.workMarkup({verification:'verified',workId:'ethics',sourceURL});
    assert.doesNotMatch(markup,/<a/,sourceURL);
  }
  const safe=S.workMarkup({verification:'verified',workId:'ethics',sourceURL:'https://example.test/?q="<script>&x=1'});
  assert.match(safe,/target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(safe,/<script|href="[^"]*"<script/);
  assert.match(safe,/&amp;x=1/);
});

test('all classic quotation work mappings resolve to book sources with matching library editions',()=>{
  const S=sources(),window={};
  const context=vm.createContext({window});
  for(const file of ['quotes-data.js','quote-authors.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../public',file),'utf8'),context);
  const expected=['nicomachean-ethics','meditations','enchiridion','letter-to-menoeceus','moral-letters','ethics'];
  for(let i=1;i<=24;i++){
    const q=window.MOQuoteCatalog.find(item=>item.id==='classic-'+i),workId=expected[Math.floor((i-1)/4)];
    assert.ok(q,'classic-'+i);
    assert.equal(q.workId,workId,'classic-'+i+' identifies its actual work');
    assert.equal(q.verification,'verified');
    const work=S.works[workId];
    assert.deepEqual(ids(S.matchingBooks(q,[{id:workId,title:work.title,author:work.author}])),[workId]);
    assert.match(S.workMarkup(q),/class="quote-source-link"/);
  }
});
