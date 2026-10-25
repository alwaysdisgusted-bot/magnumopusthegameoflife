(() => {
  'use strict';

  // Work identity is deliberately separate from a reader's particular edition.
  const works = {
    'nicomachean-ethics': { title:'Etika Nikomachova', author:'Aristoteles', authorAliases:['Aristoteles','Aristotle'], aliases:['Etika Nikomachova','Etika Níkomachova','Nikomachova etika','Nicomachean Ethics','The Nicomachean Ethics','Ethica Nicomachea'], kind:'book', sourceURL:'https://classics.mit.edu/Aristotle/nicomachaen.2.ii.html' },
    meditations: { title:'Hovory k sebe', author:'Marcus Aurelius', authorAliases:['Marcus Aurelius','Marcus Aurelius Antoninus','Aurelius, Marcus','Marek Aurelius'], aliases:['Hovory k sebe','Hovory k sobě','Meditations','The Meditations'], kind:'book', sourceURL:'https://classics.mit.edu/Antoninus/meditations.4.four.html' },
    enchiridion: { title:'Rukoväť', author:'Epiktétos', authorAliases:['Epiktétos','Epiktetos','Epictetus','Epiktét'], aliases:['Rukoväť','Rukojeť','Enchiridion','The Enchiridion','Handbook','The Handbook','Manual','The Manual'], kind:'book', sourceURL:'https://classics.mit.edu/Epictetus/epicench.html' },
    'letter-to-menoeceus': { title:'List Menoikeovi', author:'Epikuros', authorAliases:['Epikuros','Epikúros','Epicurus'], aliases:['List Menoikeovi','Letter to Menoeceus','Letter to Menoecus','Epistle to Menoeceus'], kind:'book', sourceURL:'https://classics.mit.edu/Epicurus/menoec.html' },
    'moral-letters': { title:'Listy Luciliovi', author:'Seneca', authorAliases:['Seneca','Lucius Annaeus Seneca','Seneca, Lucius Annaeus','Seneca the Younger','Séneca'], aliases:['Listy Luciliovi','Letters to Lucilius','Moral Letters to Lucilius','Moral Epistles','Epistulae morales ad Lucilium'], kind:'book', sourceURL:'https://constitutioncenter.org/the-constitution/historic-document-library/detail/seneca-moral-letters-to-luciliuson-saving-time-ca-65' },
    ethics: { title:'Etika', author:'Baruch Spinoza', authorAliases:['Baruch Spinoza','Spinoza, Baruch','Benedict de Spinoza','Benedictus de Spinoza','Benedict Spinoza','Spinoza'], aliases:['Etika','Ethics','The Ethics','Ethica','Ethica ordine geometrico demonstrata'], kind:'book', sourceURL:'https://www.gutenberg.org/files/3800/3800-h/3800-h.htm' },
    physics: { title:'Fyzika', author:'Aristoteles', authorAliases:['Aristoteles','Aristotle'], aliases:['Fyzika','Physics','The Physics','Physica'], kind:'book', sourceURL:'https://classics.mit.edu/Aristotle/physics.1.i.html' },
    'vatican-sayings': { title:'Vatikánske výroky', author:'Epikuros', authorAliases:['Epikuros','Epikúros','Epicurus'], aliases:['Vatikánske výroky','Vatican Sayings','The Vatican Sayings','Sententiae Vaticanae'], kind:'book', sourceURL:'https://monadnock.net/epicurus/vatican-sayings.html' },
    'de-rerum-natura': { title:'O prírode', author:'Lucretius', authorAliases:['Lucretius','Titus Lucretius Carus','Lucretius Carus','Lukrécius','Lukrétius'], aliases:['O prírode','O prirodzenosti vecí','O podstatě světa','De rerum natura','On the Nature of Things','The Nature of Things'], kind:'book', sourceURL:'https://classics.mit.edu/Carus/nature_things.2.ii.html' },
    'myth-of-sisyphus': { title:'Mýtus o Sizyfovi', author:'Albert Camus', authorAliases:['Albert Camus','Camus, Albert'], aliases:['Mýtus o Sizyfovi','Mýtus o Sisyfovi','The Myth of Sisyphus','Le Mythe de Sisyphe'], kind:'book', sourceURL:'https://www.penguinrandomhouse.com/books/23470/the-myth-of-sisyphus-by-albert-camus/' },
    'capitalist-realism': { title:'Capitalist Realism: Is There No Alternative?', author:'Mark Fisher', authorAliases:['Mark Fisher','Fisher, Mark'], aliases:['Kapitalistický realizmus','Kapitalistický realismus','Capitalist Realism'], kind:'book', sourceURL:'https://www.collectiveinkbooks.com/zer0-books/our-books/capitalist-realism-new-edition' },
    'american-nightmare': { title:'American Nightmare: Neoliberalism, Neoconservatism, and De-Democratization', author:'Wendy Brown', authorAliases:['Wendy Brown','Brown, Wendy'], aliases:['American Nightmare'], kind:'article', sourceURL:'https://journals.sagepub.com/doi/10.1177/0090591706293016' },
    'dynamic-evolution': { title:'Dynamicko-evolučné poňatie sveta v rámci starovekých myšlienkových systémov', author:'Marián Lipták', authorAliases:['Marián Lipták','Lipták, Marián'], aliases:['Dynamicko-evolučné poňatie sveta v rámci starovekých myšlienkových systémov'], kind:'article', sourceURL:'https://www.unipo.sk/sites/default/files/content/73759/ATeR-1_2013.pdf' },
    'steinberg-spinoza': { title:'Spinoza', author:'Diane Steinberg', authorAliases:['Diane Steinberg','Steinberg, Diane'], aliases:['Spinoza'], kind:'book', sourceURL:'https://m.marencin.sk/?b=b116&e=1' },
    'dtfh-611': { title:'Duncan Trussell Family Hour, 611: Jason Louv', author:'Jason Louv', authorAliases:['Jason Louv'], aliases:[], kind:'podcast', sourceURL:'https://open.spotify.com/episode/1bmMZcVWM9rUA4DcqcDpwC' },
    'changed-mind-242': { title:'A Changed Mind, 242: The Mirror Principle: What The “Elites” Know That You Were Never Taught', author:'David Bayer', authorAliases:['David Bayer'], aliases:[], kind:'podcast', sourceURL:'https://davidbayer.com/podcast/episode-242/' },
    satires: { title:'Satiry', author:'Horatius', authorAliases:['Horatius','Horace','Quintus Horatius Flaccus'], aliases:['Satiry','Satires','The Satires','Sermones'], kind:'book', sourceURL:'https://www.thelatinlibrary.com/horace/serm1.shtml' }
  };
  Object.keys(works).forEach(id => { works[id].id=id; });

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const normalized = value => String(value == null ? '' : value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');

  function safeURL(value) {
    if(typeof value !== 'string' || !/^https:\/\//i.test(value) || /[\u0000-\u0020\u007f\\]/.test(value))return '';
    try {
      const parsed = new URL(value);
      return parsed.protocol==='https:' && parsed.hostname && !parsed.username && !parsed.password ? parsed.href : '';
    } catch { return ''; }
  }

  function titleMatches(title, work) {
    const full=normalized(title);
    if(!full)return false;
    const base=normalized(String(title).split(/:|[—–]/,1)[0]);
    return [work.title].concat(work.aliases).some(alias => normalized(alias)===full || normalized(alias)===base);
  }

  function matchingBooks(quote, books, workId=quote && quote.workId) {
    const work=Object.prototype.hasOwnProperty.call(works,workId) ? works[workId] : null;
    if(!quote || quote.verification!=='verified' || !work || work.kind!=='book' || !Array.isArray(books))return [];
    const authors=[work.author].concat(work.authorAliases).map(normalized).filter(Boolean);
    return books.filter(book => book && typeof book==='object' && authors.includes(normalized(book.author)) && titleMatches(book.title,work));
  }

  function sectionMarkup(section) {
    return section ? '<span class="quote-source-section"> · '+esc(section)+'</span>' : '';
  }

  function sourceRow(workId, verified, label, section, sourceURL, options) {
    const work=Object.prototype.hasOwnProperty.call(works,workId) ? works[workId] : null;
    if(!work)return '';
    const href=safeURL(sourceURL || work.sourceURL);
    const title=href ? '<a class="quote-source-link" href="'+esc(href)+'" target="_blank" rel="noopener noreferrer">'+esc(work.title)+' ↗</a>' : '<span class="quote-work-title">'+esc(work.title)+'</span>';
    const privateBooks=options.linkBooks && verified ? matchingBooks({verification:'verified'},options.books,workId) : [];
    const buttons=privateBooks.filter(book => typeof book.id==='string' && book.id).map(book => '<button class="btn secondary small" type="button" data-action="book-detail" data-id="'+esc(book.id)+'">Otvoriť v mojej knižnici: '+esc(book.title)+'</button>').join('');
    return '<div class="quote-work"><span class="quote-source-label">'+esc(label)+': </span>'+title+sectionMarkup(section)+(buttons ? '<div class="quote-book-links">'+buttons+'</div>' : '')+'</div>';
  }

  function workMarkup(quote, {books=[],linkBooks=false}={}) {
    if(!quote || typeof quote!=='object')return '';
    const options={books,linkBooks}, verified=quote.verification==='verified';
    const main=sourceRow(quote.workId,verified,verified?'Prameň':'Možný prameň',quote.sourceSection || quote.section,quote.sourceURL,options);
    const relatedVerified=(quote.relatedVerification || quote.relatedWorkVerification)==='verified';
    const related=sourceRow(quote.relatedWorkId,relatedVerified,relatedVerified?'Citované v':'Možno citované v',quote.relatedSourceSection || quote.relatedSection,quote.relatedSourceURL,options);
    return main+related;
  }

  window.MOQuoteSources={works,matchingBooks,workMarkup,sectionMarkup};
})();
