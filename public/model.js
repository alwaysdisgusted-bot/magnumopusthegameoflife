(function (root, factory) {
  'use strict';
  var api = factory(typeof module === 'object' && module.exports ? require('./knowledge-catalog.cjs') : root.MOKnowledgeCatalog);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MOModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (KnowledgeCatalog) {
  'use strict';

  var LIMIT = 1000000000000;
  var CATALOG = [
    { id: 'classic', name: 'Učeň hviezd', type: 'outfit', price: 0, description: 'Tvoj prvý čarodejnícky odev.', color: '#6862bb', icon: '🧙' },
    { id: 'rose', name: 'Ružový alchymista', type: 'outfit', price: 12, description: 'Pre kúzla s vlastnou osobnosťou.', color: '#d57c9f', icon: '🌸' },
    { id: 'forest', name: 'Strážca lesa', type: 'outfit', price: 18, description: 'Plášť vo farbách zarastenej dedinky.', color: '#477456', icon: '🌿' },
    { id: 'midnight', name: 'Polnočný mág', type: 'outfit', price: 30, description: 'Kobaltový odev pre nočných objaviteľov.', color: '#4058a6', icon: '🌙' },
    { id: 'cat', name: 'Mačka Luna', type: 'animal', price: 8, description: 'Malá spoločníčka s veľkou osobnosťou.', color: '#b692c5', icon: '🐈' },
    { id: 'owl', name: 'Sova Atlas', type: 'animal', price: 15, description: 'Tichý pozorovateľ tvojich pokrokov.', color: '#d9ae54', icon: '🦉' },
    { id: 'fox', name: 'Líška Iskra', type: 'animal', price: 24, description: 'Zvedavá obyvateľka čarodejovej farmy.', color: '#b95c4b', icon: '🦊' }
  ];
  var DAILY = [
    { id: 'reading-20', title: 'Kapitola pre seba', description: 'Prečítaj dnes 20 nových strán.', metric: 'reading', target: 20, powder: 1 },
    { id: 'exercise-10', title: 'Rozhýb čarodeja', description: 'Zapíš dnes 10 opakovaní alebo splnení cvikov.', metric: 'exercise', target: 10, powder: 1 },
    { id: 'meditation-25', title: 'Chvíľa ticha', description: 'Medituj dnes celkovo 25 minút.', metric: 'meditation', target: 25, powder: 1 }
  ];
  CATALOG.forEach(Object.freeze);
  DAILY.forEach(Object.freeze);
  Object.freeze(CATALOG);
  Object.freeze(DAILY);

  function fail(message) { throw new Error(message); }
  function integer(value, min, max, label) {
    if (!Number.isSafeInteger(value) || value < min || value > max) fail((label || 'Hodnota') + ' musí byť celé číslo od ' + min + ' do ' + max + '.');
    return value;
  }
  function string(value, max, label, empty) {
    if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail('Neplatné pole: ' + label + '.');
    return value;
  }
  function plain(value, allowed, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail('Neplatný objekt: ' + label + '.');
    Reflect.ownKeys(value).forEach(function (key) {
      if (typeof key !== 'string' || key === '__proto__' || key === 'constructor' || key === 'prototype' || (allowed && allowed.indexOf(key) < 0)) fail('Nepovolené pole v ' + label + '.');
      var descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) fail('Nepovolené pole v ' + label + '.');
    });
    return value;
  }
  function list(value, max, label) {
    if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) fail('Neplatný zoznam: ' + label + '.');
    for (var i = 0; i < value.length; i++) if (!Object.prototype.hasOwnProperty.call(value, i)) fail('Neplatný zoznam: ' + label + '.');
    return value;
  }
  function id(value) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) fail('Neplatný identifikátor.');
    return value;
  }
  function uid(prefix) {
    var token = typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-' + Math.random().toString(36).slice(2);
    return prefix + '-' + token;
  }
  function dateKey(date) {
    var value = date === undefined ? new Date() : new Date(date);
    if (!Number.isFinite(value.getTime())) fail('Neplatný dátum.');
    var parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bratislava', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
    function part(type) { return parts.find(function (p) { return p.type === type; }).value; }
    return part('year') + '-' + part('month') + '-' + part('day');
  }
  function validDay(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + 'T00:00:00.000Z')) || new Date(value + 'T00:00:00.000Z').toISOString().slice(0, 10) !== value) fail('Neplatný deň v zálohe.');
    return value;
  }
  function tags(value) {
    if (value === undefined) return [];
    var seen = new Set();
    return list(value, 30, 'tagy').map(function (tag) {
      tag = string(tag, 60, 'tag', false).trim();
      var normalized = tag.toLocaleLowerCase('sk');
      if (seen.has(normalized)) fail('Tagy sa nesmú opakovať.');
      seen.add(normalized);
      return tag;
    });
  }
  function cover(value) {
    if (value === undefined || value === '') return '';
    if (typeof value !== 'string' || value.length > 2800000 || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) fail('Obálka musí byť obrázok PNG, JPEG, WEBP alebo GIF, najviac 2 MB.');
    return value;
  }
  function find(items, itemId, label) {
    var item = items.find(function (entry) { return entry.id === itemId; });
    if (!item) fail((label || 'Položka') + ' sa nenašla.');
    return item;
  }
  function balance(state) { return state.ledger.reduce(function (sum, entry) { return sum + entry.coins; }, 0); }
  function powder(state) { return state.ledger.reduce(function (sum, entry) { return sum + entry.powder; }, 0); }
  function metricProgress(state, metric, day) {
    return state.ledger.reduce(function (sum, entry) { return sum + (entry.metric === metric && entry.dateKey === day ? entry.amount : 0); }, 0);
  }
  function entry(state, type, label, coins, dust, amount, metric, ref) {
    if (state.ledger.length >= 30000) fail('Denník je plný. Najprv si exportuj zálohu.');
    integer(coins, -LIMIT, LIMIT, 'Odmena');
    integer(balance(state) + coins, 0, LIMIT, 'Počet korún');
    integer(powder(state) + dust, 0, LIMIT, 'Zelený prášok');
    var now = new Date();
    var item = { id: uid('log'), type: type, label: label, coins: coins, powder: dust, amount: amount, metric: metric || '', ref: ref || '', at: now.toISOString(), dateKey: dateKey(now) };
    state.ledger.push(item);
    return item;
  }
  function createState() {
    return {
      version: 1, profile: { name: 'Čarodej', equipped: 'classic' }, books: [],
      exercises: [{ id: uid('exercise'), name: 'Kliky', mode: 'reps', threshold: 10, reward: 1, remainder: 0, total: 0, completions: 0 }],
      ledger: [], wardrobe: ['classic'], animals: [],
      reading: { remainder: 0, threshold: 20, reward: 1 },
      meditation: { total: 0, remainder: 0, threshold: 25, reward: 1 },
      projects: [], bank: { currency: 'EUR', card: 0, cash: 0, invested: 0, owed: 0, receivable: 0 },
      strategies: [], settings: { calendarUrl: '', goodreadsUrl: '' }, dailyClaims: {},
      learning: { definitions: [], gilded: [], reviews: [], pending: null, lastReviewActiveMs: 0 }
    };
  }
  function bookFields(input, current) {
    plain(input, null, 'kniha');
    var total = integer(input.total, 1, 100000, 'Počet strán');
    if (total < current) fail('Celkový počet strán nemôže byť menší než prečítané strany.');
    var fields = { title: string(input.title, 200, 'názov', false).trim(), author: string(input.author === undefined ? '' : input.author, 200, 'autor', true).trim(), total: total, tags: tags(input.tags), cover: cover(input.cover) };
    if (input.notes !== undefined) fields.notes = string(input.notes, 20000, 'poznámky knihy', true);
    if (input.goodreads !== undefined) {
      var g = plain(input.goodreads, ['id', 'isbn', 'shelf', 'rating'], 'Goodreads');
      if (typeof g.id !== 'string' || !/^(?:[0-9]{1,30})?$/.test(g.id)) fail('Neplatné Goodreads ID.');
      if (typeof g.isbn !== 'string' || !/^(?:[0-9]{10}|[0-9]{13})?$/.test(g.isbn)) fail('Neplatné ISBN.');
      fields.goodreads = { id: g.id, isbn: g.isbn, shelf: string(g.shelf, 80, 'polička Goodreads', true), rating: integer(g.rating, 0, 5, 'Hodnotenie Goodreads') };
    }
    return fields;
  }
  function addBook(state, input) {
    if (state.books.length >= 500) fail('Knižnica už má 500 kníh.');
    var current = integer(input.current === undefined ? 0 : input.current, 0, 100000, 'Prečítané strany');
    var fields = bookFields(input, current);
    var book = Object.assign({ id: uid('book') }, fields, { current: current });
    state.books.push(book);
    return book;
  }
  function updateBook(state, bookId, input) {
    var book = find(state.books, bookId, 'Kniha');
    plain(input, null, 'úprava knihy');
    if (input.current !== undefined && input.current !== book.current) fail('Nové strany zapíš cez čítanie knihy.');
    var next = bookFields(Object.assign({}, book, input), book.current);
    Object.assign(book, next);
    return book;
  }
  function readBook(state, bookId, current) {
    var book = find(state.books, bookId, 'Kniha');
    integer(current, book.current, book.total, 'Aktuálna strana');
    var amount = current - book.current;
    if (!amount) return { earned: 0, amount: 0 };
    var accumulated = state.reading.remainder + amount;
    var earned = Math.floor(accumulated / state.reading.threshold) * state.reading.reward;
    entry(state, 'reading', book.title, earned, 0, amount, 'reading', book.id);
    book.current = current;
    state.reading.remainder = accumulated % state.reading.threshold;
    return { earned: earned, amount: amount };
  }
  function historicalReadingPlan(state) {
    var threshold = integer(state.reading.threshold, 1, 100000, 'Strany na odmenu');
    var reward = integer(state.reading.reward, 1, 100000, 'Odmena za čítanie');
    var remainder = integer(state.reading.remainder, 0, threshold - 1, 'Zvyšné strany');
    var credited = Object.create(null), entries = [], totals = { books: 0, pages: 0, earned: 0 };
    list(state.ledger, 30000, 'denník').forEach(function (record) {
      if (record.type !== 'reading' && record.type !== 'reading-history') return;
      var ref = id(record.ref), amount = integer(record.amount, 1, LIMIT, 'Započítané strany');
      credited[ref] = integer((credited[ref] || 0) + amount, 0, Number.MAX_SAFE_INTEGER, 'Započítané strany');
    });
    list(state.books, 500, 'knihy').forEach(function (book) {
      var total = integer(book.total, 1, 100000, 'Počet strán');
      var current = integer(book.current, 0, total, 'Prečítané strany');
      if (current !== total) return;
      var ref = id(book.id), amount = Math.max(0, total - (credited[ref] || 0));
      if (!amount) return;
      var accumulated = remainder + amount, earned = Math.floor(accumulated / threshold) * reward;
      remainder = accumulated % threshold;
      entries.push({ ref: ref, label: string(book.title, 200, 'názov knihy', false), amount: amount, earned: earned, remainder: remainder });
      totals.books++; totals.pages += amount; totals.earned = integer(totals.earned + earned, 0, Number.MAX_SAFE_INTEGER, 'Odmena za dočítané knihy');
    });
    return { entries: entries, totals: totals };
  }
  function previewHistoricalReading(state) {
    return historicalReadingPlan(state).totals;
  }
  function claimHistoricalReading(state) {
    var plan = historicalReadingPlan(state);
    if (!plan.entries.length) return plan.totals;
    if (state.ledger.length + plan.entries.length > 30000) fail('Denník je plný. Najprv si exportuj zálohu.');
    integer(balance(state) + plan.totals.earned, 0, LIMIT, 'Počet korún');
    integer(powder(state), 0, LIMIT, 'Zelený prášok');
    plan.entries.forEach(function (credit) {
      entry(state, 'reading-history', credit.label, credit.earned, 0, credit.amount, '', credit.ref);
      state.reading.remainder = credit.remainder;
    });
    return plan.totals;
  }
  function exerciseFields(input) {
    plain(input, null, 'cvik');
    var mode = input.mode === undefined ? 'reps' : input.mode;
    if (mode !== 'reps' && mode !== 'completion') fail('Neplatný typ cviku.');
    var threshold = mode === 'completion' ? 1 : integer(input.threshold === undefined ? 10 : input.threshold, 1, 100000, 'Počet opakovaní');
    return { name: string(input.name, 160, 'názov cviku', false).trim(), mode: mode, threshold: threshold, reward: integer(input.reward === undefined ? 1 : input.reward, 1, 100000, 'Odmena') };
  }
  function addExercise(state, input) {
    if (state.exercises.length >= 500) fail('Posilňovňa už má 500 cvikov.');
    var fields = exerciseFields(input);
    var exercise = Object.assign({ id: uid('exercise') }, fields, { remainder: 0, total: 0, completions: 0 });
    state.exercises.push(exercise);
    return exercise;
  }
  function updateExercise(state, exerciseId, input) {
    var exercise = find(state.exercises, exerciseId, 'Cvik');
    plain(input, null, 'úprava cviku');
    var fields = exerciseFields(Object.assign({}, exercise, input));
    if (fields.mode !== exercise.mode || fields.threshold !== exercise.threshold || fields.reward !== exercise.reward) exercise.remainder = 0;
    Object.assign(exercise, fields);
    return exercise;
  }
  function logExercise(state, exerciseId, count) {
    var exercise = find(state.exercises, exerciseId, 'Cvik');
    integer(count, 1, exercise.mode === 'completion' ? 1 : 1000000, 'Počet');
    var accumulated = exercise.remainder + count;
    var completed = Math.floor(accumulated / exercise.threshold);
    var earned = completed * exercise.reward;
    integer(exercise.total + count, 0, LIMIT, 'Celkový počet opakovaní');
    entry(state, 'exercise', exercise.name, earned, 0, count, 'exercise', exercise.id);
    exercise.total += count;
    exercise.completions += completed;
    exercise.remainder = accumulated % exercise.threshold;
    return { earned: earned, amount: count };
  }
  function meditate(state, minutes) {
    integer(minutes, 1, 1000000, 'Počet minút');
    integer(state.meditation.total + minutes, 0, LIMIT, 'Celková meditácia');
    var accumulated = state.meditation.remainder + minutes;
    var earned = Math.floor(accumulated / state.meditation.threshold) * state.meditation.reward;
    entry(state, 'meditation', 'Meditácia', earned, 0, minutes, 'meditation', '');
    state.meditation.total += minutes;
    state.meditation.remainder = accumulated % state.meditation.threshold;
    return { earned: earned, amount: minutes };
  }
  function buy(state, catalogId) {
    var item = find(CATALOG, catalogId, 'Tovar');
    var owned = item.type === 'outfit' ? state.wardrobe : state.animals;
    if (owned.indexOf(item.id) >= 0) fail('Túto položku už vlastníš.');
    if (balance(state) < item.price) fail('Na túto položku ešte nemáš dosť korún.');
    entry(state, 'purchase', item.name, -item.price, 0, 1, '', item.id);
    owned.push(item.id);
    return item;
  }
  function equip(state, outfitId) {
    var item = find(CATALOG, outfitId, 'Odev');
    if (item.type !== 'outfit' || state.wardrobe.indexOf(item.id) < 0) fail('Tento odev ešte nevlastníš.');
    state.profile.equipped = item.id;
    return item;
  }
  function addProject(state, title) {
    if (state.projects.length >= 1000) fail('Galéria už má 1 000 projektov.');
    var project = { id: uid('project'), title: string(title, 200, 'názov projektu', false).trim(), done: false };
    state.projects.push(project);
    return project;
  }
  function finishProject(state, projectId) {
    var project = find(state.projects, projectId, 'Projekt');
    if (project.done) fail('Tento projekt už je dokončený.');
    entry(state, 'project', project.title, 1, 0, 1, '', project.id);
    project.done = true;
    return { earned: 1, amount: 1 };
  }
  function claimDaily(state, dailyId, day) {
    var task = find(DAILY, dailyId, 'Výzva');
    day = day === undefined ? dateKey() : validDay(day);
    if (day !== dateKey()) fail('Odmenu môžeš vyzdvihnúť iba za dnešný deň.');
    var claims = state.dailyClaims[day] || [];
    if (claims.indexOf(task.id) >= 0) fail('Túto odmenu si už dnes vyzdvihol.');
    if (metricProgress(state, task.metric, day) < task.target) fail('Denná výzva ešte nie je splnená.');
    entry(state, 'daily', task.title, 0, task.powder, task.powder, '', task.id);
    state.dailyClaims[day] = claims.concat(task.id);
    return { earned: 0, amount: task.powder };
  }

  const LEARNING_INTERVAL = 600000;
  const learningFold = value => value.trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('sk').replace(/\s+/g, ' ');
  const learningKey = (fieldId, term) => fieldId + ':' + learningFold(term);
  function learningTerms(custom = []) {
    const terms = new Map();
    KnowledgeCatalog.fields.forEach(field => field.categories.forEach(category => category.terms.forEach(term => terms.set(learningKey(field.id, term), {fieldId:field.id,term}))));
    list(custom, 5000, 'vlastné pojmy').forEach(item => {
      plain(item, ['fieldId','term'], 'vlastný pojem');
      if (!KnowledgeCatalog.fields.some(field => field.id === item.fieldId)) fail('Neznámy odbor pojmu.');
      const term = string(item.term,150,'pojem',false).trim();
      terms.set(learningKey(item.fieldId,term),{fieldId:item.fieldId,term});
    });
    return [...terms.values()];
  }
  function learningProgress(state, custom = []) {
    const terms = learningTerms(custom), completed = new Set(state.learning.definitions.map(item => learningKey(item.fieldId,item.term)));
    return {
      definitions:terms.filter(item => completed.has(learningKey(item.fieldId,item.term))).length, total:terms.length,
      gilded:state.learning.gilded.length, pillars:KnowledgeCatalog.sefirot.length,
      nodes:KnowledgeCatalog.sefirot.map(node => {
        const required = terms.filter(item => node.fields.includes(item.fieldId));
        return {id:node.id,total:required.length,definitions:required.filter(item=>completed.has(learningKey(item.fieldId,item.term))).length,gilded:state.learning.gilded.some(item=>item.id===node.id)};
      })
    };
  }
  function learningSources(input) {
    const sources = list(input,3,'zdroje');
    if (sources.length !== 3) fail('Vyber presne tri rôzne nahrané zdroje.');
    const clean = sources.map(source => {
      plain(source,['id','name','sha256'],'zdroj definície');
      const copy = {id:string(source.id,150,'odkaz zdroja',false),name:string(source.name,255,'názov zdroja',false),sha256:string(source.sha256,64,'odtlačok zdroja',false)};
      if (!/^[a-f0-9]{64}$/.test(copy.sha256)) fail('Chýba overenie originálu zdroja.');
      return copy;
    });
    if (new Set(clean.map(item=>item.id)).size !== 3 || new Set(clean.map(item=>item.sha256)).size !== 3) fail('Zdroje musia mať tri rôzne originály; premenovanie súboru nestačí.');
    return clean;
  }
  function saveLearningDefinition(state, input, custom = []) {
    plain(input,['fieldId','term','definition','sources','expectedRevision'],'definícia');
    const terms = learningTerms(custom), key = learningKey(string(input.fieldId,100,'odbor',false),string(input.term,150,'pojem',false));
    const term = terms.find(item=>learningKey(item.fieldId,item.term)===key);
    if (!term) fail('Pojem sa nenachádza v tomto odbore mapy.');
    const definition = string(input.definition,4000,'vlastná definícia',false).trim(), sources = learningSources(input.sources);
    let stored = state.learning.definitions.find(item=>learningKey(item.fieldId,item.term)===key);
    if (integer(input.expectedRevision,0,1000000,'Revízia definície') !== (stored?.revision || 0)) fail('Definícia sa medzičasom zmenila. Načítaj uloženú verziu.');
    let earned = 0;
    if (stored) { stored.definition=definition; stored.sources=sources; stored.revision++; }
    else {
      if (state.learning.definitions.length >= 5000) fail('Najviac 5 000 vlastných definícií.');
      stored={id:uid('definition'),fieldId:term.fieldId,term:term.term,definition,sources,revision:1};
      state.learning.definitions.push(stored);
      entry(state,'knowledge-definition',('Definícia: '+term.term).slice(0,200),30,0,1,'',stored.id);
      earned=30;
    }
    const gilded=[];
    for (const node of learningProgress(state,custom).nodes) {
      if (!node.gilded && node.total && node.definitions===node.total) {
        const fields = KnowledgeCatalog.sefirot.find(item=>item.id===node.id).fields;
        const definitionIds=terms.filter(item=>fields.includes(item.fieldId)).map(item=>state.learning.definitions.find(definition=>learningKey(definition.fieldId,definition.term)===learningKey(item.fieldId,item.term)).id);
        state.learning.gilded.push({id:node.id,definitionIds});
        entry(state,'knowledge-pillar','Zlatý pilier: '+KnowledgeCatalog.sefirot.find(item=>item.id===node.id).name,300,0,1,'',node.id);
        gilded.push(node.id); earned+=300;
      }
    }
    return {earned,gilded,definitionId:stored.id};
  }
  function beginLearningReview(state, activeMs, random = Math.random) {
    integer(activeMs,0,Number.MAX_SAFE_INTEGER,'Aktívny čas');
    if (state.learning.pending) return state.learning.pending;
    if (!state.learning.definitions.length || activeMs-state.learning.lastReviewActiveMs < LEARNING_INTERVAL) return null;
    if (state.learning.reviews.length >= 10000) fail('Denník opakovania je plný. Exportuj zálohu.');
    const sample=random();
    if (!Number.isFinite(sample) || sample<0 || sample>=1) fail('Neplatný výber otázky.');
    const source=state.learning.definitions[Math.floor(sample*state.learning.definitions.length)];
    state.learning.pending={id:uid('review'),definitionId:source.id,revision:source.revision,fieldId:source.fieldId,term:source.term,definition:source.definition};
    state.learning.lastReviewActiveMs=activeMs;
    return state.learning.pending;
  }
  function answerLearningReview(state, questionId, answer) {
    const pending=state.learning.pending;
    if (!pending || pending.id!==questionId) fail('Táto otázka už bola zodpovedaná alebo nie je aktuálna.');
    const correct=learningFold(string(answer,150,'odpoveď',false))===learningFold(pending.term);
    state.learning.reviews.push({id:pending.id,definitionId:pending.definitionId,correct});
    state.learning.pending=null;
    if (correct) entry(state,'knowledge-review',('Poznám pojem: '+pending.term).slice(0,200),3,0,1,'',pending.id);
    return {correct,earned:correct?3:0,term:pending.term};
  }
  function validateLearning(raw) {
    plain(raw,['definitions','gilded','reviews','pending','lastReviewActiveMs'],'poznanie');
    const keys=new Set(), ids=new Set();
    const definitions=list(raw.definitions,5000,'definície').map(item=>{
      plain(item,['id','fieldId','term','definition','sources','revision'],'definícia');
      if (!KnowledgeCatalog.fields.some(field=>field.id===item.fieldId)) fail('Neznámy odbor definície.');
      const copy={id:id(item.id),fieldId:item.fieldId,term:string(item.term,150,'pojem',false),definition:string(item.definition,4000,'definícia',false),sources:learningSources(item.sources),revision:integer(item.revision,1,1000000,'Revízia definície')};
      const key=learningKey(copy.fieldId,copy.term);
      if (keys.has(key)||ids.has(copy.id)) fail('Definícia sa opakuje.');
      keys.add(key);ids.add(copy.id);return copy;
    });
    const gildedIds=new Set();
    const gilded=list(raw.gilded,10,'zlaté piliere').map(item=>{
      plain(item,['id','definitionIds'],'zlatý pilier');
      const node=KnowledgeCatalog.sefirot.find(node=>node.id===item.id);
      if (!node || gildedIds.has(item.id)) fail('Neplatný alebo opakovaný zlatý pilier.');
      const refs=list(item.definitionIds,5000,'definície piliera').map(value=>{
        const definition=definitions.find(definition=>definition.id===value);
        if (!definition || !node.fields.includes(definition.fieldId)) fail('Pilier má neplatnú definíciu.');
        return definition;
      });
      if (new Set(item.definitionIds).size!==refs.length || !learningTerms().filter(term=>node.fields.includes(term.fieldId)).every(term=>refs.some(definition=>learningKey(definition.fieldId,definition.term)===learningKey(term.fieldId,term.term)))) fail('Zlatý pilier nemá vyplnené všetky terminológie.');
      gildedIds.add(item.id);return {id:item.id,definitionIds:refs.map(item=>item.id)};
    });
    const reviewIds=new Set();
    const reviews=list(raw.reviews,10000,'opakovania').map(item=>{
      plain(item,['id','definitionId','correct'],'opakovanie');
      if (!ids.has(item.definitionId)||reviewIds.has(id(item.id))||typeof item.correct!=='boolean') fail('Neplatné opakovanie.');
      reviewIds.add(item.id);return {id:item.id,definitionId:item.definitionId,correct:item.correct};
    });
    let pending=null;
    if (raw.pending!==null) {
      const item=plain(raw.pending,['id','definitionId','revision','fieldId','term','definition'],'otázka'), definition=definitions.find(definition=>definition.id===item.definitionId);
      if (!definition||reviewIds.has(id(item.id))||item.fieldId!==definition.fieldId||item.term!==definition.term) fail('Neplatná rozpracovaná otázka.');
      pending={id:item.id,definitionId:definition.id,revision:integer(item.revision,1,definition.revision,'Revízia otázky'),fieldId:definition.fieldId,term:definition.term,definition:string(item.definition,4000,'definícia otázky',false)};
    }
    const lastReviewActiveMs=integer(raw.lastReviewActiveMs,0,Number.MAX_SAFE_INTEGER,'Aktívny čas');
    if(lastReviewActiveMs<(reviews.length+(pending?1:0))*LEARNING_INTERVAL)fail('Čas opakovania nesúhlasí s otázkami.');
    return {definitions,gilded,reviews,pending,lastReviewActiveMs};
  }

  function validateState(raw) {
    plain(raw, ['version', 'profile', 'books', 'exercises', 'ledger', 'wardrobe', 'animals', 'reading', 'meditation', 'projects', 'bank', 'strategies', 'settings', 'dailyClaims', 'learning'], 'záloha');
    if (raw.version !== 1) fail('Táto verzia zálohy nie je podporovaná.');
    var result = createState();
    if (raw.learning !== undefined) result.learning=validateLearning(raw.learning);
    plain(raw.profile, ['name', 'equipped'], 'profil');
    result.profile = { name: string(raw.profile.name, 80, 'meno', false), equipped: id(raw.profile.equipped) };
    var usedIds = new Set();
    function unique(value) { value = id(value); if (usedIds.has(value)) fail('Záloha obsahuje opakovaný identifikátor.'); usedIds.add(value); return value; }
    result.books = list(raw.books, 500, 'knihy').map(function (book) {
      plain(book, ['id', 'title', 'author', 'total', 'current', 'tags', 'cover', 'goodreads', 'notes'], 'kniha');
      var current = integer(book.current, 0, 100000, 'Prečítané strany');
      return Object.assign({ id: unique(book.id) }, bookFields(book, current), { current: current });
    });
    result.exercises = list(raw.exercises, 500, 'cviky').map(function (exercise) {
      plain(exercise, ['id', 'name', 'mode', 'threshold', 'reward', 'remainder', 'total', 'completions'], 'cvik');
      var fields = exerciseFields(exercise);
      if (exercise.threshold !== fields.threshold) fail('Neplatný počet opakovaní cviku.');
      var total = integer(exercise.total, 0, LIMIT, 'Celkový počet');
      return Object.assign({ id: unique(exercise.id) }, fields, {
        remainder: integer(exercise.remainder, 0, fields.threshold - 1, 'Zvyšné opakovania'), total: total,
        completions: integer(exercise.completions, 0, total, 'Počet splnení')
      });
    });
    plain(raw.reading, ['remainder', 'threshold', 'reward'], 'čítanie');
    result.reading = { threshold: integer(raw.reading.threshold, 1, 100000, 'Strany na odmenu'), reward: integer(raw.reading.reward, 1, 100000, 'Odmena za čítanie'), remainder: integer(raw.reading.remainder, 0, raw.reading.threshold - 1, 'Zvyšné strany') };
    plain(raw.meditation, ['total', 'remainder', 'threshold', 'reward'], 'meditácia');
    result.meditation = { threshold: integer(raw.meditation.threshold, 1, 100000, 'Minúty na odmenu'), reward: integer(raw.meditation.reward, 1, 100000, 'Odmena za meditáciu'), total: integer(raw.meditation.total, 0, LIMIT, 'Celková meditácia'), remainder: integer(raw.meditation.remainder, 0, raw.meditation.threshold - 1, 'Zvyšné minúty') };
    result.projects = list(raw.projects, 1000, 'projekty').map(function (project) {
      plain(project, ['id', 'title', 'done'], 'projekt');
      if (typeof project.done !== 'boolean') fail('Neplatný stav projektu.');
      return { id: unique(project.id), title: string(project.title, 200, 'názov projektu', false), done: project.done };
    });
    function ownership(items, type) {
      var seen = new Set();
      return list(items, CATALOG.length, 'vlastnené položky').map(function (itemId) {
        var item = find(CATALOG, id(itemId), 'Vlastnená položka');
        if (item.type !== type || seen.has(itemId)) fail('Neplatné vlastníctvo položiek.');
        seen.add(itemId); return itemId;
      });
    }
    result.wardrobe = ownership(raw.wardrobe, 'outfit');
    result.animals = ownership(raw.animals, 'animal');
    if (result.wardrobe.indexOf('classic') < 0 || result.wardrobe.indexOf(result.profile.equipped) < 0) fail('Profil musí mať oblečený vlastnený odev.');
    plain(raw.bank, ['currency', 'card', 'cash', 'invested', 'owed', 'receivable'], 'banka');
    if (raw.bank.currency !== 'EUR') fail('Neplatná mena banky.');
    result.bank = { currency: 'EUR' };
    ['card', 'cash', 'invested', 'owed', 'receivable'].forEach(function (key) {
      var value = raw.bank[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > LIMIT || Math.abs(value * 100 - Math.round(value * 100)) > 0.01) fail('Neplatná suma v banke.');
      result.bank[key] = value;
    });
    result.strategies = list(raw.strategies, 100, 'stratégie').map(function (strategy) {
      plain(strategy, ['id', 'title', 'target', 'monthly', 'deadline', 'notes'], 'stratégia');
      ['target', 'monthly'].forEach(function (key) {
        var amount = strategy[key];
        if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > LIMIT || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.01) fail('Neplatná suma vo finančnej stratégii.');
      });
      var deadline = strategy.deadline === '' ? '' : validDay(strategy.deadline);
      return { id: unique(strategy.id), title: string(strategy.title, 200, 'názov stratégie', false), target: strategy.target, monthly: strategy.monthly, deadline: deadline, notes: string(strategy.notes, 20000, 'poznámky stratégie', true) };
    });
    plain(raw.settings, ['calendarUrl', 'goodreadsUrl'], 'nastavenia');
    var url = string(raw.settings.calendarUrl, 2000, 'odkaz na kalendár', true);
    if (url && !/^https?:\/\/[^\s]+$/i.test(url)) fail('Kalendár musí mať platný webový odkaz.');
    var goodreadsUrl = string(raw.settings.goodreadsUrl === undefined ? '' : raw.settings.goodreadsUrl, 1000, 'profil Goodreads', true);
    if (goodreadsUrl && !/^https:\/\/(?:www\.)?goodreads\.com\/user\/show\/[0-9]{1,30}$/.test(goodreadsUrl)) fail('Neplatný odkaz na profil Goodreads.');
    result.settings = { calendarUrl: url, goodreadsUrl: goodreadsUrl };
    plain(raw.dailyClaims, null, 'denné odmeny');
    var claimDays = Object.keys(raw.dailyClaims);
    if (claimDays.length > 36600) fail('Príliš veľa denných odmien.');
    result.dailyClaims = {};
    claimDays.forEach(function (day) {
      validDay(day);
      var claims = list(raw.dailyClaims[day], DAILY.length, 'denné odmeny').map(function (claim) { find(DAILY, claim, 'Výzva'); return claim; });
      if (new Set(claims).size !== claims.length || claims.length === 0) fail('Neplatná denná odmena.');
      result.dailyClaims[day] = claims.slice();
    });
    var purchases = new Set(), completedProjects = new Set(), awardedDaily = new Set(), learningRewards = new Set();
    var readTotals = Object.create(null), exerciseTotals = Object.create(null), dailyTotals = Object.create(null);
    var meditationTotal = 0, coinTotal = 0, dustTotal = 0;
    result.ledger = list(raw.ledger, 30000, 'denník').map(function (record) {
      plain(record, ['id', 'type', 'label', 'coins', 'powder', 'amount', 'metric', 'ref', 'at', 'dateKey'], 'záznam denníka');
      var copy = { id: unique(record.id), type: string(record.type, 20, 'typ záznamu', false), label: string(record.label, 200, 'popis záznamu', false), coins: integer(record.coins, -LIMIT, LIMIT, 'Koruny'), powder: integer(record.powder, 0, LIMIT, 'Prášok'), amount: integer(record.amount, 1, LIMIT, 'Množstvo'), metric: string(record.metric, 20, 'typ aktivity', true), ref: string(record.ref, 100, 'odkaz záznamu', true), at: string(record.at, 30, 'čas záznamu', false), dateKey: validDay(record.dateKey) };
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(copy.at) || !Number.isFinite(Date.parse(copy.at)) || new Date(copy.at).toISOString() !== copy.at || dateKey(copy.at) !== copy.dateKey) fail('Nekonzistentný dátum záznamu.');
      if (['reading', 'exercise', 'meditation'].indexOf(copy.type) >= 0) {
        if (copy.metric !== copy.type || copy.coins < 0 || copy.powder !== 0) fail('Neplatný záznam aktivity.');
        var dailyKey = copy.dateKey + ':' + copy.type;
        dailyTotals[dailyKey] = (dailyTotals[dailyKey] || 0) + copy.amount;
        if (copy.type === 'reading') {
          find(result.books, copy.ref, 'Kniha v denníku');
          readTotals[copy.ref] = (readTotals[copy.ref] || 0) + copy.amount;
        } else if (copy.type === 'exercise') {
          find(result.exercises, copy.ref, 'Cvik v denníku');
          exerciseTotals[copy.ref] = (exerciseTotals[copy.ref] || 0) + copy.amount;
        } else {
          if (copy.ref !== '') fail('Neplatný záznam meditácie.');
          meditationTotal += copy.amount;
        }
      } else if (copy.type === 'reading-history') {
        if (copy.metric !== '' || copy.coins < 0 || copy.powder !== 0) fail('Neplatné doplnenie odmeny za čítanie.');
        find(result.books, copy.ref, 'Kniha v denníku');
        readTotals[copy.ref] = (readTotals[copy.ref] || 0) + copy.amount;
      } else if (copy.type === 'purchase') {
        var item = find(CATALOG, copy.ref, 'Tovar v denníku');
        if (item.id === 'classic' || purchases.has(item.id) || copy.coins !== -item.price || copy.powder !== 0 || copy.amount !== 1 || copy.metric !== '') fail('Neplatný nákup v zálohe.');
        purchases.add(item.id);
      } else if (copy.type === 'project') {
        var project = find(result.projects, copy.ref, 'Projekt v denníku');
        if (!project.done || completedProjects.has(project.id) || copy.coins !== 1 || copy.powder !== 0 || copy.amount !== 1 || copy.metric !== '') fail('Neplatná odmena za projekt.');
        completedProjects.add(project.id);
      } else if (copy.type === 'daily') {
        var task = find(DAILY, copy.ref, 'Výzva v denníku');
        var key = copy.dateKey + ':' + task.id;
        if (awardedDaily.has(key) || copy.coins !== 0 || copy.powder !== task.powder || copy.amount !== task.powder || copy.metric !== '' || (dailyTotals[copy.dateKey + ':' + task.metric] || 0) < task.target || !(result.dailyClaims[copy.dateKey] || []).includes(task.id)) fail('Neplatná odmena za dennú výzvu.');
        awardedDaily.add(key);
      } else if (copy.type === 'knowledge-term') {
        const rewardKey = copy.type + ':' + copy.ref;
        if (!/^term_[a-f0-9-]{36}$/.test(copy.ref) || learningRewards.has(rewardKey) ||
          copy.coins !== 10 || copy.powder !== 0 || copy.amount !== 1 || copy.metric !== '' ||
          copy.id !== 'reward-' + copy.ref) fail('Neplatná alebo opakovaná odmena za terminológiu.');
        learningRewards.add(rewardKey);
      } else if (copy.type === 'grimoire-reading') {
        if (!/^[a-f0-9-]{36}$/.test(copy.ref) || copy.id !== 'reading-' + copy.ref ||
          copy.coins !== 1 || copy.powder !== 0 || copy.amount !== 25 || copy.metric !== '') fail('Neplatná odmena za listovanie v Grimoári.');
      } else if (['knowledge-definition','knowledge-pillar','knowledge-review'].includes(copy.type)) {
        const rewardKey=copy.type+':'+copy.ref;
        const valid=copy.type==='knowledge-definition' ? result.learning.definitions.some(item=>item.id===copy.ref) : copy.type==='knowledge-pillar' ? result.learning.gilded.some(item=>item.id===copy.ref) : result.learning.reviews.some(item=>item.id===copy.ref&&item.correct);
        const coins=copy.type==='knowledge-definition'?30:copy.type==='knowledge-pillar'?300:3;
        if (!valid||learningRewards.has(rewardKey)||copy.coins!==coins||copy.powder!==0||copy.amount!==1||copy.metric!=='') fail('Neplatná alebo opakovaná odmena za poznanie.');
        learningRewards.add(rewardKey);
      } else fail('Neznámy typ záznamu v denníku.');
      coinTotal = integer(coinTotal + copy.coins, 0, LIMIT, 'Zostatok korún');
      dustTotal = integer(dustTotal + copy.powder, 0, LIMIT, 'Zostatok prášku');
      return copy;
    });
    result.books.forEach(function (book) { if ((readTotals[book.id] || 0) > book.current) fail('Progres knihy nesúhlasí s denníkom.'); });
    result.exercises.forEach(function (exercise) { if ((exerciseTotals[exercise.id] || 0) !== exercise.total) fail('Progres cviku nesúhlasí s denníkom.'); });
    if (meditationTotal !== result.meditation.total) fail('Progres meditácie nesúhlasí s denníkom.');
    result.projects.forEach(function (project) { if (project.done !== completedProjects.has(project.id)) fail('Projekty nesúhlasia s denníkom.'); });
    CATALOG.forEach(function (item) {
      if (item.id !== 'classic' && purchases.has(item.id) !== (item.type === 'outfit' ? result.wardrobe : result.animals).includes(item.id)) fail('Nákupy nesúhlasia so šatníkom alebo farmou.');
    });
    claimDays.forEach(function (day) { result.dailyClaims[day].forEach(function (taskId) { if (!awardedDaily.has(day + ':' + taskId)) fail('Denné odmeny nesúhlasia s denníkom.'); }); });
    [['knowledge-definition',result.learning.definitions],['knowledge-pillar',result.learning.gilded],['knowledge-review',result.learning.reviews.filter(item=>item.correct)]].forEach(([type,items])=>items.forEach(item=>{if(!learningRewards.has(type+':'+item.id))fail('Poznanie nesúhlasí s denníkom odmien.');}));
    return result;
  }

  return { CATALOG: CATALOG, DAILY: DAILY, LEARNING_INTERVAL, learningKey, learningTerms, learningProgress, saveLearningDefinition, beginLearningReview, answerLearningReview, createState: createState, validateState: validateState, balance: balance, powder: powder, dateKey: dateKey, metricProgress: metricProgress, addBook: addBook, updateBook: updateBook, readBook: readBook, previewHistoricalReading: previewHistoricalReading, claimHistoricalReading: claimHistoricalReading, addExercise: addExercise, updateExercise: updateExercise, logExercise: logExercise, meditate: meditate, buy: buy, equip: equip, addProject: addProject, finishProject: finishProject, claimDaily: claimDaily };
});
