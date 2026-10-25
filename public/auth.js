(function () {
  'use strict';

  var hooks = {};
  var account = null;
  var csrf = '';
  var revision = 0;
  var updatedAt = null;
  var pending = null;
  var sequence = 0;
  var inFlight = null;
  var debounceTimer = null;
  var conflict = false;
  var lastError = null;
  var saveStatus = 'saved';
  var authMode = 'register';
  var authMessage = '';
  var authBusy = false;
  var logoutBusy = false;
  var suspendedAccount = null;
  var heldDrafts = new Map();
  var invalidLocalDraft = null;
  var localMode = false;
  var terminologyBusy = false;

  var esc = function (value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var clone = function (value) { return JSON.parse(JSON.stringify(value)); };
  var cacheKey = function (id) { return 'magnum-opus:account:' + id; };

  function writeSync(id, isPending, cloudRevision, cloudUpdatedAt) {
    if (!id) return;
    try {
      localStorage.setItem(cacheKey(id) + ':sync', JSON.stringify({ pending: !!isPending, revision: cloudRevision, updatedAt: cloudUpdatedAt || null }));
    } catch (_) { /* The queued state remains in memory if browser storage is full. */ }
  }

  function cachedDraft(id) {
    var metadata, raw;
    try {
      metadata = JSON.parse(localStorage.getItem(cacheKey(id) + ':sync') || 'null');
      if (!metadata || metadata.pending !== true || !Number.isSafeInteger(metadata.revision)) return null;
      raw = localStorage.getItem(cacheKey(id));
      if (!raw) return null;
      var state = window.MOModel.validateState(JSON.parse(raw));
      return { draft: { state: state, sequence: ++sequence, accountId: id }, revision: metadata.revision };
    } catch (_) {
      if (raw && metadata && metadata.pending === true) {
        invalidLocalDraft = { raw: raw, accountId: id };
        throw apiError('Neuloženú hru z prehliadača sa nepodarilo načítať. Najprv si ju môžeš stiahnuť; potom môžeš pokračovať s uloženým progresom.', 0, 'INVALID_LOCAL_DRAFT');
      }
      return null;
    }
  }
  var glyph = function (name) {
    var paths = {
      save: '<path d="M5 3h12l4 4v14H3V3h2Zm2 0v7h10V3M7 21v-7h10v7"/>',
      logout: '<path d="M9 4H3v16h6m5-14 6 6-6 6m-7-6h13"/>',
      check: '<path d="m5 12 4 4L20 5"/>',
      shield: '<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Z"/><path d="m8 12 3 3 5-6"/>',
      star: '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/>'
    };
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || paths.star) + '</svg>';
  };

  function apiError(message, status, code, payload) {
    var error = new Error(message);
    error.status = status || 0;
    error.code = code || 'REQUEST_FAILED';
    error.payload = payload || null;
    return error;
  }

  async function api(path, options) {
    options = options || {};
    if (typeof path !== 'string' || !/^\/api\//.test(path) || path.indexOf('\\') !== -1) {
      throw apiError('Neplatná adresa požiadavky.', 0, 'INVALID_API_PATH');
    }
    var method = String(options.method || 'GET').toUpperCase();
    var headers = { 'X-MO-Request': '1', 'Accept': 'application/json' };
    if (method !== 'GET' && method !== 'HEAD') {
      headers['Content-Type'] = 'application/json';
      if (csrf) headers['X-MO-CSRF'] = csrf;
    }
    var response;
    try {
      response = await fetch(path, {
        method: method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
    } catch (_) {
      throw apiError(localMode ? 'Lokálna hra nie je spustená. Otvor spúšťač Magnum Opus a skús to znova.' : 'Spojenie sa nepodarilo. Skontroluj internet a skús to znova.', 0, 'NETWORK_ERROR');
    }
    var data = null;
    try { data = await response.json(); } catch (_) { /* A non-JSON failure still gets a useful message. */ }
    if (!response.ok) {
      var message = data && data.error && typeof data.error.message === 'string' ? data.error.message :
        data && typeof data.message === 'string' ? data.message :
        data && typeof data.error === 'string' ? data.error :
        response.status === 401 ? 'Prihlásenie vypršalo. Prihlás sa znova.' :
        response.status === 409 ? 'Uložená hra sa medzitým zmenila v inom okne.' :
        'Požiadavku sa nepodarilo dokončiť. Skús to znova.';
      var error = apiError(message, response.status, data && (data.error && data.error.code || data.code), data);
      if (response.status === 401 && account) expireSession();
      throw error;
    }
    return data;
  }

  function authRoot() {
    var root = document.getElementById('auth-screen');
    if (!root) {
      root = document.createElement('section');
      root.id = 'auth-screen';
      root.className = 'mo-auth-screen';
      root.setAttribute('aria-label', 'Vstup do Magnum Opus');
      document.body.appendChild(root);
    }
    root.hidden = false;
    document.body.classList.add('auth-locked');
    document.body.classList.remove('menu-open');
    var gameModal = document.getElementById('modal');
    if (gameModal && gameModal.open) gameModal.close();
    return root;
  }

  function shell(content) {
    return '<div class="mo-auth-world" aria-hidden="true"></div>' +
      '<div class="mo-auth-card"><div class="mo-auth-brand"><img src="assets/wizard.svg" width="62" height="79" alt=""><div><span>MAGNUM OPUS</span><small>THE GAME OF LIFE</small></div></div>' + content +
      '<p class="mo-auth-motto">Veľké dielo sa tvorí malými krokmi.</p></div>' +
      '<p class="mo-auth-world-note">Tvoja dedinka. Tvoj príbeh. Tvoje tempo.</p>';
  }

  function showLoading() {
    authRoot().innerHTML = shell('<div class="mo-auth-loading" role="status">' + glyph('star') + '<h1>Otvárame tvoju dedinku</h1><p>Chvíľku strpenia…</p></div>');
  }

  function showRetry(message) {
    var root = authRoot();
    root.innerHTML = shell('<p class="mo-auth-eyebrow">BRÁNA JE ZATIAĽ ZATVORENÁ</p><h1>Nepodarilo sa otvoriť profil</h1><p class="mo-auth-copy">' + esc(message) + '</p><button type="button" class="mo-auth-submit" data-auth-retry>Skúsiť znova</button>' + (invalidLocalDraft ? '<div class="mo-auth-pending"><button type="button" data-auth-export-invalid>Stiahnuť pôvodné lokálne údaje</button><button type="button" data-auth-use-cloud>Použiť uložený progres</button></div>' : ''));
    root.querySelector('[data-auth-retry]').addEventListener('click', function () { init(hooks); });
    if (invalidLocalDraft) {
      root.querySelector('[data-auth-export-invalid]').addEventListener('click', function () { downloadData(invalidLocalDraft.raw, 'magnum-opus-povodne-lokalne-udaje.json'); });
      root.querySelector('[data-auth-use-cloud]').addEventListener('click', function () {
        if (!window.confirm('Pokračovať s uloženým progresom? Nečitateľné údaje v prehliadači budú nahradené.')) return;
        try { localStorage.removeItem(cacheKey(invalidLocalDraft.accountId) + ':sync'); } catch (_) { return; }
        invalidLocalDraft = null;
        init(hooks);
      });
    }
  }

  function showSiteLogin() {
    var returnTo = window.location.pathname + window.location.search + window.location.hash;
    var url = '/signin-with-chatgpt?return_to=' + encodeURIComponent(returnTo);
    authRoot().innerHTML = shell('<p class="mo-auth-eyebrow">VITAJ V MAGNUM OPUS</p><h1>Tvoj svet čaká</h1><p class="mo-auth-copy">Najprv sa prihlás cez ChatGPT. Potom si vytvoríš vlastné meno a heslo čarodeja alebo otvoríš svoj existujúci profil.</p><a class="mo-auth-submit" href="' + esc(url) + '" target="_top">Pokračovať cez ChatGPT <span aria-hidden="true">↗</span></a><p class="mo-auth-hint">Po prihlásení sa vrátiš do svojej dedinky.</p>');
  }

  function legacyState() {
    try { return hooks.getLegacyState ? hooks.getLegacyState() : null; } catch (_) { return null; }
  }

  function hasLegacy(state) {
    return !!(state && (
      ['books', 'exercises', 'ledger', 'projects', 'animals', 'strategies'].some(function (key) { return Array.isArray(state[key]) && state[key].length; }) ||
      (state.bank && ['card', 'cash', 'invested', 'owed', 'receivable'].some(function (key) { return Number(state.bank[key]) > 0; }))
    ));
  }

  function renderAuth(mode, message) {
    if (localMode) { renderLocalEntry(message); return; }
    authMode = mode || authMode;
    authMessage = message || '';
    authBusy = false;
    var register = authMode === 'register';
    var legacy = register && hasLegacy(legacyState());
    var root = authRoot();
    root.innerHTML = shell('<div class="mo-auth-tabs" role="tablist" aria-label="Vstup do hry"><button type="button" role="tab" aria-selected="' + register + '" data-auth-mode="register">Nový čarodej</button><button type="button" role="tab" aria-selected="' + !register + '" data-auth-mode="login">Prihlásenie</button></div>' +
      '<p class="mo-auth-eyebrow">' + (register ? 'TU SA ZAČÍNA TVOJ PRÍBEH' : 'DOBRÉ VEDIEŤ, ŽE SI SPÄŤ') + '</p><h1>' + (register ? 'Vytvor si čarodeja' : 'Vitaj späť, čarodej') + '</h1>' +
      '<p class="mo-auth-copy">' + (register ? 'Vyber si meno a vlastné heslo. Tvoj profil aj progres budú uložené v tvojom účte.' : 'Otvor si svoj profil a pokračuj tam, kde si skončil.') + '</p>' +
      '<form id="mo-auth-form" novalidate><div class="mo-auth-field"><label for="mo-auth-name">Meno čarodeja</label><input id="mo-auth-name" name="name" type="text" autocomplete="username" minlength="3" maxlength="32" required spellcheck="false" placeholder="Ako sa budeš volať?" value="' + esc(suspendedAccount ? suspendedAccount.name : '') + '"><small>3 až 32 znakov</small></div>' +
      '<div class="mo-auth-field"><label for="mo-auth-password">Heslo</label><input id="mo-auth-password" name="password" type="password" autocomplete="' + (register ? 'new-password' : 'current-password') + '" minlength="12" maxlength="128" required><small>12 až 128 znakov</small></div>' +
      (register ? '<div class="mo-auth-field"><label for="mo-auth-confirm">Potvrď heslo</label><input id="mo-auth-confirm" name="confirm" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></div>' : '') +
      (legacy ? '<label class="mo-auth-import"><input type="checkbox" name="importLegacy" checked><span>Preniesť moju doterajšiu hru z tohto prehliadača<small>Knihy, cviky, koruny a ostatný progres.</small></span></label>' : '') +
      '<p class="mo-auth-feedback' + (authMessage ? ' has-message' : '') + '" id="mo-auth-feedback" role="alert">' + esc(authMessage) + '</p><button class="mo-auth-submit" type="submit">' + (register ? 'Vytvoriť čarodeja' : 'Otvoriť moju dedinku') + '</button></form>' +
      (pending ? '<div class="mo-auth-pending"><p>Neuložené zmeny sú stále v tomto okne. Pred zatvorením si ich môžeš stiahnuť.</p><button type="button" data-auth-export>Exportovať neuloženú hru</button></div>' : '') +
      '<p class="mo-auth-privacy">' + glyph('shield') + '<span>Heslo sa v tomto prehliadači neukladá.</span></p>');
    root.querySelectorAll('[data-auth-mode]').forEach(function (button) {
      button.addEventListener('click', function () { if (!authBusy) renderAuth(button.dataset.authMode); });
    });
    root.querySelector('#mo-auth-form').addEventListener('submit', submitAuth);
    var exportButton = root.querySelector('[data-auth-export]');
    if (exportButton) exportButton.addEventListener('click', exportCurrent);
  }

  function renderLocalEntry(message) {
    var root = authRoot();
    root.innerHTML = shell('<p class="mo-auth-eyebrow">LOKÁLNY PROFIL</p><h1>Tvoja dedinka v tomto počítači</h1><p class="mo-auth-copy">Progres a poznámky sa ukladajú do tvojej lokálnej zložky. Nepotrebuješ internet ani prihlásenie cez ChatGPT.</p>' + (message ? '<p class="mo-auth-feedback has-message" role="alert">' + esc(message) + '</p>' : '') + '<button type="button" class="mo-auth-submit" data-local-open>Otvoriť moju dedinku</button>');
    root.querySelector('[data-local-open]').addEventListener('click', function () { init(hooks); });
  }

  async function submitAuth(event) {
    event.preventDefault();
    if (authBusy) return;
    var form = event.currentTarget;
    var name = form.elements.name.value.trim().normalize('NFC');
    var password = form.elements.password.value;
    var feedback = form.querySelector('#mo-auth-feedback');
    var error = '';
    if (name.length < 3 || name.length > 32 || /[\u0000-\u001f\u007f]/.test(name)) error = 'Meno čarodeja musí mať 3 až 32 znakov.';
    else if (password.length < 12 || password.length > 128) error = 'Heslo musí mať 12 až 128 znakov.';
    else if (authMode === 'register' && password !== form.elements.confirm.value) error = 'Heslá sa nezhodujú. Skontroluj potvrdenie hesla.';
    if (error) {
      feedback.textContent = error;
      feedback.classList.add('has-message');
      return;
    }
    var body = { name: name, password: password };
    if (authMode === 'register' && form.elements.importLegacy && form.elements.importLegacy.checked) {
      var legacy = legacyState();
      if (legacy) body.initialState = clone(legacy);
    }
    authBusy = true;
    var submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    submit.textContent = authMode === 'register' ? 'Tvoríme tvojho čarodeja…' : 'Otvárame dedinku…';
    feedback.textContent = '';
    feedback.classList.remove('has-message');
    form.querySelectorAll('input').forEach(function (input) { input.disabled = true; });
    try {
      var payload = await api('/api/auth/' + (authMode === 'register' ? 'register' : 'login'), { method: 'POST', body: body });
      form.elements.password.value = '';
      if (form.elements.confirm) form.elements.confirm.value = '';
      body.password = '';
      await activateSession(payload);
    } catch (failure) {
      feedback.textContent = failure.message;
      feedback.classList.add('has-message');
      submit.disabled = false;
      submit.textContent = authMode === 'register' ? 'Vytvoriť čarodeja' : 'Otvoriť moju dedinku';
      form.querySelectorAll('input').forEach(function (input) { input.disabled = false; });
    } finally {
      body.password = '';
      password = '';
      authBusy = false;
    }
  }

  async function activateSession(payload, options) {
    options = options || {};
    if (!payload || !payload.account || !payload.account.id) throw apiError('Server neposlal platný profil. Skús sa prihlásiť znova.', 0, 'INVALID_SESSION');
    var previous = account;
    var previousPending = pending;
    var saved = payload.save || { state: null, revision: 0, updatedAt: null };
    var serverRevision = Number.isSafeInteger(saved.revision) ? saved.revision : 0;
    if (pending && pending.accountId !== payload.account.id) {
      heldDrafts.set(pending.accountId, { draft: pending, revision: revision });
      pending = null;
    }
    if (!pending && heldDrafts.has(payload.account.id) && !options.discardPending) {
      var held = heldDrafts.get(payload.account.id);
      pending = held.draft;
      revision = held.revision;
      heldDrafts.delete(payload.account.id);
    }
    if (!pending && !options.discardPending) {
      var cached = cachedDraft(payload.account.id);
      if (cached) { pending = cached.draft; revision = cached.revision; }
    }
    var previousRevision = revision;
    var draftToRestore = !options.discardPending && pending && pending.accountId === payload.account.id ? pending : null;
    if (options.discardPending) pending = null;
    if (payload.localMode === true) localMode = true;
    account = { id: payload.account.id, name: String(payload.account.name || 'Čarodej') };
    csrf = typeof payload.csrf === 'string' ? payload.csrf : csrf;
    revision = draftToRestore ? previousRevision : serverRevision;
    updatedAt = saved.updatedAt || null;
    conflict = !!(draftToRestore && previousRevision !== serverRevision);
    lastError = conflict ? apiError('Uložená hra sa medzitým zmenila. Vyber, ako chceš pokračovať.', 409, 'SAVE_CONFLICT') : null;
    saveStatus = conflict ? 'conflict' : draftToRestore ? 'pending' : 'saved';
    try {
      await hooks.activate({ account: getAccount(), state: draftToRestore ? clone(draftToRestore.state) : saved.state, revision: revision, updatedAt: updatedAt });
    } catch (failure) {
      pending = pending || previousPending;
      account = null;
      csrf = '';
      if (previous && !suspendedAccount) suspendedAccount = previous;
      if (hooks.deactivate) hooks.deactivate({ preserveDraft: true });
      showRetry(failure.message);
      throw failure;
    }
    suspendedAccount = null;
    var root = document.getElementById('auth-screen');
    if (root) { root.hidden = true; root.innerHTML = ''; }
    document.body.classList.remove('auth-locked');
    writeSync(account.id, !!pending, revision, updatedAt);
    renderControls();
    if (pending && !conflict) scheduleSave();
  }

  function expireSession() {
    if (!account) return;
    var current = null;
    try { current = hooks.getState ? hooks.getState() : null; } catch (_) { /* Preserve an existing queued draft. */ }
    if (current) pending = { state: clone(current), sequence: ++sequence, accountId: account.id };
    writeSync(account.id, !!pending, revision, updatedAt);
    suspendedAccount = account;
    account = null;
    csrf = '';
    clearTimeout(debounceTimer);
    saveStatus = 'error';
    if (hooks.deactivate) hooks.deactivate({ preserveDraft: true });
    renderControls();
    renderAuth('login', 'Prihlásenie vypršalo. Prihlás sa znova; neuložené zmeny sú zachované v tomto okne.');
  }

  async function init(nextHooks) {
    hooks = nextHooks || hooks;
    showLoading();
    try {
      var payload = await api('/api/auth/session');
      localMode = !!(payload && payload.localMode);
      if (localMode && !payload.account) payload = await api('/api/auth/local', { method: 'POST', body: {} });
      if (payload && payload.account) {
        await activateSession(payload);
        return { authenticated: true, account: getAccount() };
      }
      account = null;
      csrf = payload && typeof payload.csrf === 'string' ? payload.csrf : '';
      if (payload && payload.requiresSiteLogin) showSiteLogin();
      else renderAuth(payload && payload.hasAccount ? 'login' : 'register');
      return { authenticated: false };
    } catch (failure) {
      account = null;
      showRetry(failure.message);
      return { authenticated: false, error: failure };
    }
  }

  function getAccount() { return account ? { id: account.id, name: account.name } : null; }

  function scheduleSave() {
    if (terminologyBusy) return;
    clearTimeout(debounceTimer);
    if (!account || conflict || !pending) return;
    debounceTimer = setTimeout(function () { saveNow().catch(function () { /* Status and draft remain available. */ }); }, 600);
  }

  function queueSave(state) {
    if (!account || logoutBusy) throw apiError(logoutBusy ? 'Prebieha odhlásenie. Chvíľku počkaj.' : 'Pred uložením sa prihlás.', 401, 'AUTH_REQUIRED');
    pending = { state: clone(state), sequence: ++sequence, accountId: account.id };
    writeSync(account.id, true, revision, updatedAt);
    if (!conflict) saveStatus = inFlight ? 'saving' : 'pending';
    renderControls();
    scheduleSave();
  }

  function saveNow() {
    if (terminologyBusy) return Promise.reject(apiError('Práve sa potvrdzuje terminológia a jej odmena. Koncept hry zostáva zachovaný.', 409, 'TERM_BUSY'));
    clearTimeout(debounceTimer);
    if (inFlight) return inFlight;
    if (!account) return Promise.reject(apiError('Pred uložením sa prihlás.', 401, 'AUTH_REQUIRED'));
    if (conflict) return Promise.reject(lastError || apiError('Najprv vyrieš rozdiel medzi uloženými hrami.', 409, 'SAVE_CONFLICT'));
    if (!pending) { saveStatus = 'saved'; renderControls(); return Promise.resolve({ revision: revision, updatedAt: updatedAt }); }
    var savingAccount = account.id;
    inFlight = (async function () {
      while (pending && account && account.id === savingAccount && !conflict) {
        var draft = pending;
        pending = null;
        saveStatus = 'saving';
        lastError = null;
        renderControls();
        try {
          var response = await api('/api/save', { method: 'PUT', body: { state: draft.state, expectedRevision: revision } });
          if (!response || !Number.isSafeInteger(response.revision)) throw apiError('Server nepotvrdil uloženie. Skús to znova.', 0, 'INVALID_SAVE_RESPONSE');
          revision = response.revision;
          updatedAt = response.updatedAt || null;
          if (pending) writeSync(savingAccount, true, revision, updatedAt);
          else {
            var cacheStillMatches = true;
            try {
              var rawCache = localStorage.getItem(cacheKey(savingAccount));
              cacheStillMatches = !rawCache || JSON.stringify(JSON.parse(rawCache)) === JSON.stringify(draft.state);
            } catch (_) { cacheStillMatches = false; }
            // A different tab may have written its own pending local draft meanwhile.
            if (cacheStillMatches) writeSync(savingAccount, false, revision, updatedAt);
          }

        } catch (failure) {
          if (!pending || pending.sequence < draft.sequence) pending = draft;
          lastError = failure;
          conflict = failure.status === 409;
          saveStatus = conflict ? 'conflict' : 'error';
          writeSync(draft.accountId, true, revision, updatedAt);
          renderControls();
          throw failure;
        }
      }
      saveStatus = conflict ? 'conflict' : pending ? 'pending' : 'saved';
      renderControls();
      return { revision: revision, updatedAt: updatedAt };
    })().finally(function () {
      inFlight = null;
      renderControls();
    });
    return inFlight;
  }

  async function mutateTerminology(body, endpoint) {
    if (terminologyBusy) throw apiError('Predchádzajúca zmena alebo odmena sa ešte ukladá.', 409, 'TERM_BUSY');
    await saveNow();
    if (terminologyBusy) throw apiError('Predchádzajúca zmena alebo odmena sa ešte ukladá.', 409, 'TERM_BUSY');
    var baseline = clone(hooks.getState());
    var mutationAccount = account.id;
    terminologyBusy = true;
    clearTimeout(debounceTimer);
    function withoutRewards(value) {
      var copy = clone(value);
      copy.ledger = copy.ledger.filter(function (entry) { return entry.type !== 'knowledge-term' && entry.type !== 'grimoire-reading'; });
      return JSON.stringify(copy);
    }
    function reconcile(saved) {
      if (!saved || !Number.isSafeInteger(saved.revision) || !saved.state ||
        !account || account.id !== mutationAccount || conflict ||
        withoutRewards(saved.state) !== withoutRewards(baseline)) {
        throw apiError('Uložená hra sa zmenila aj mimo odmeny. Koncept zostal zachovaný; načítaj uložený progres.', 409, 'TERM_SAVE_CONFLICT');
      }
      var latest = clone(hooks.getState());
      var hadPending = !!pending;
      var rewards = saved.state.ledger.filter(function (entry) { return entry.type === 'knowledge-term' || entry.type === 'grimoire-reading'; });
      latest.ledger = latest.ledger.map(function (entry) {
        if (entry.type !== 'knowledge-term' && entry.type !== 'grimoire-reading') return entry;
        var receipt = rewards.find(function (reward) { return reward.id === entry.id; });
        if (!receipt) throw apiError('Odmena nemá serverové potvrdenie.', 409, 'TERM_SAVE_CONFLICT');
        return receipt;
      });
      rewards.forEach(function (receipt) {
        if (!latest.ledger.some(function (entry) { return entry.id === receipt.id; })) latest.ledger.push(receipt);
      });
      latest = window.MOModel.validateState(latest);
      revision = saved.revision; updatedAt = saved.updatedAt;
      hooks.applyServerState(latest);
      pending = hadPending || JSON.stringify(latest) !== JSON.stringify(saved.state)
        ? { state: latest, sequence: ++sequence, accountId: mutationAccount } : null;
      writeSync(mutationAccount, !!pending, revision, updatedAt);
    }
    try {
      var response = await api(endpoint || '/api/knowledge/grimoire/terminology', {
        method: 'POST', body: Object.assign({}, body, { expectedGameRevision: revision })
      });
      if (response.save) reconcile(response.save);
      return response;
    } catch (failure) {
      // A disconnected response can follow a committed receipt. Recover only
      // the authoritative reward delta, never overwrite unrelated local edits.
      if (account && account.id === mutationAccount) {
        try {
          var saved = await api('/api/save');
          reconcile(saved);
        } catch (recoveryFailure) {
          if (account && account.id === mutationAccount) {
            conflict = true;
            lastError = recoveryFailure;
            pending = {state:clone(hooks.getState()),sequence:++sequence,accountId:mutationAccount};
            writeSync(mutationAccount, true, revision, updatedAt);
          }
        }
      }
      throw failure;
    } finally {
      terminologyBusy = false;
      saveStatus = conflict ? 'conflict' : pending ? 'pending' : 'saved';
      renderControls();
      if (pending && !conflict) scheduleSave();
    }
  }

  function exportCurrent() {
    if (account && hooks.exportBackup) { hooks.exportBackup(); return; }
    if (!pending) return;
    downloadData(JSON.stringify({ app: 'magnum-opus', exportedAt: new Date().toISOString(), state: pending.state }, null, 2), 'magnum-opus-neulozena-hra-' + new Date().toISOString().slice(0, 10) + '.json');
  }

  function downloadData(data, filename) {
    var blob = new Blob([data], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  async function loadCloud() {
    if (terminologyBusy) throw apiError('Počkaj na potvrdenie odmeny; aktuálna hra zostáva otvorená.', 409, 'TERM_BUSY');
    if (!account || inFlight) return;
    var confirmed = window.confirm((localMode ? 'Načítať uloženú hru z lokálnej zložky?' : 'Načítať uloženú hru zo servera?') + ' Aktuálne neuložené zmeny budú nahradené. Ak si ich chceš uchovať, najprv zvoľ Exportovať aktuálnu hru.');
    if (!confirmed) return;
    var savedAccount = getAccount();
    var saved = await api('/api/save');
    await activateSession({ account: savedAccount, csrf: csrf, save: saved, localMode: localMode }, { discardPending: true });
  }

  async function logout() {
    if (terminologyBusy) throw apiError('Počkaj na potvrdenie odmeny; profil zostáva otvorený.', 409, 'TERM_BUSY');
    if (!account || logoutBusy) return false;
    var academyDrafts = window.MOAcademy && window.MOAcademy.hasUnsavedDrafts && window.MOAcademy.hasUnsavedDrafts();
    var studyDrafts = window.MOStudy && window.MOStudy.hasUnsavedDrafts && window.MOStudy.hasUnsavedDrafts();
    var knowledgeDrafts = window.MOKnowledge && window.MOKnowledge.hasUnsavedDrafts && window.MOKnowledge.hasUnsavedDrafts();
    var calendarDrafts = window.MODayNotes && window.MODayNotes.hasUnsavedDrafts && window.MODayNotes.hasUnsavedDrafts();
    var socialDrafts = window.MOSocial && window.MOSocial.hasUnsavedDrafts && window.MOSocial.hasUnsavedDrafts();
    if ((academyDrafts || studyDrafts || knowledgeDrafts || calendarDrafts || socialDrafts) &&
      !window.confirm('V pracovni, akadémii, osobnom štúdiu, kalendári alebo pošte máš neuložené poznámky či rozpísané správy. Odhlásením sa zahodia. Chceš sa odhlásiť?')) return false;
    logoutBusy = true;
    renderControls();
    try {
      if (window.MODesk && window.MODesk.flush) await window.MODesk.flush();
      await saveNow();
      await api('/api/auth/logout', { method: 'POST', body: {} });
      account = null;
      csrf = '';
      pending = null;
      revision = 0;
      updatedAt = null;
      conflict = false;
      lastError = null;
      suspendedAccount = null;
      if (hooks.deactivate) hooks.deactivate({ preserveDraft: false });
      renderControls();
      renderAuth('login');
      return true;
    } catch (failure) {
      lastError = failure;
      saveStatus = conflict ? 'conflict' : 'error';
      renderControls();
      return false;
    } finally {
      logoutBusy = false;
      renderControls();
    }
  }

  function renderControls() {
    var controls = document.getElementById('account-controls');
    if (!account) { if (controls) controls.remove(); return; }
    if (!controls) {
      var parent = document.querySelector('.sidebar-bottom');
      if (!parent) return;
      controls = document.createElement('div');
      controls.id = 'account-controls';
      controls.className = 'mo-account-controls';
      parent.insertBefore(controls, parent.firstChild);
    }
    var status = {
      pending: 'Čaká na uloženie',
      saving: 'Ukladám…',
      saved: localMode ? 'Uložené v tomto počítači' : 'Uložené',
      error: 'Nepodarilo sa uložiť',
      conflict: 'Uložená hra sa zmenila'
    }[saveStatus] || 'Čaká na uloženie';
    var details = lastError && (saveStatus === 'error' || conflict) ? '<p class="mo-account-error">' + esc(lastError.message) + '</p>' : '';
    var actions = conflict ? '<div class="mo-account-recovery"><button type="button" data-account-action="export">Exportovať aktuálnu hru</button><button type="button" data-account-action="load-cloud"' + (inFlight ? ' disabled' : '') + '>Načítať uloženú hru</button></div>' :
      saveStatus === 'error' ? '<div class="mo-account-recovery"><button type="button" data-account-action="save">Skúsiť uložiť znova</button><button type="button" data-account-action="export">Exportovať aktuálnu hru</button></div>' : '';
    controls.innerHTML = '<div class="mo-account-status is-' + esc(saveStatus) + '" role="status" aria-live="polite"><span class="mo-account-dot" aria-hidden="true"></span><span>' + status + '</span></div>' +
      '<div class="mo-account-buttons"><button type="button" data-account-action="save" ' + (inFlight || conflict || logoutBusy ? 'disabled' : '') + '>' + glyph('save') + '<span>Uložiť</span></button><button type="button" data-account-action="logout" ' + (logoutBusy ? 'disabled' : '') + '>' + glyph('logout') + '<span>' + (logoutBusy ? 'Zatváram…' : localMode ? 'Zavrieť profil' : 'Odhlásiť') + '</span></button></div>' + details + actions;
    controls.onclick = async function (event) {
      var button = event.target.closest('[data-account-action]');
      if (!button || button.disabled) return;
      try {
        if (button.dataset.accountAction === 'save') await saveNow();
        else if (button.dataset.accountAction === 'logout') await logout();
        else if (button.dataset.accountAction === 'export') exportCurrent();
        else if (button.dataset.accountAction === 'load-cloud') await loadCloud();
      } catch (failure) { lastError = failure; saveStatus = conflict ? 'conflict' : 'error'; renderControls(); }
    };
  }

  window.addEventListener('online', function () {
    if (account && pending && !conflict) saveNow().catch(function () { /* Manual recovery remains available. */ });
  });

  function pauseForExternalChange() {
    if (!account) return;
    clearTimeout(debounceTimer);
    conflict = true;
    lastError = apiError('Hra sa zmenila v inom okne. Exportuj aktuálny stav alebo načítaj uloženú hru.', 409, 'LOCAL_TAB_CONFLICT');
    saveStatus = 'conflict';
    renderControls();
  }
  window.addEventListener('beforeunload', function (event) {
    if (pending || inFlight || terminologyBusy || heldDrafts.size) { event.preventDefault(); event.returnValue = ''; }
  });

  window.MOAuth = {
    init: init,
    isAuthenticated: function () { return !!account && !logoutBusy; },
    getAccount: getAccount,
    isLocal: function () { return localMode; },
    queueSave: queueSave,
    saveNow: saveNow,
    mutateTerminology: mutateTerminology,
    recordReadingTurn: function (body) { return mutateTerminology(body, '/api/knowledge/grimoire/reading'); },
    logout: logout,
    api: api,
    pauseForExternalChange: pauseForExternalChange,
    renderControls: renderControls
  };
})();
