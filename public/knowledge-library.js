(() => {
  'use strict';

  const CHANNEL = 'magnum-opus-knowledge-bridge';
  const MODES = Object.freeze(['grimoire', 'tree', 'books']);
  let mode = 'room', grimoireLoaded = false, treeLoaded = false;
  let grimoireReady = false, pendingSearch = null, selectedContext = null;
  const documentRequests = new Map();
  const terminologyRequests = new Set();
  const readingRequests = new Set();
  let navigationRevision = 0;
  let currentQuery = '', treeReady = false, pendingNode = null, nodeTimer = null;

  const byId = id => document.getElementById(id);
  const exactKeys = (value, keys) => !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
  const validText = (value, max) => typeof value === 'string' && value.length <= max
    && !/[\u0000-\u001f\u007f]/.test(value);
  const validNode = node => exactKeys(node, ['fieldId', 'categoryId', 'term']) &&
    typeof node.fieldId === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(node.fieldId) &&
    typeof node.categoryId === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(node.categoryId) &&
    validText(node.term, 150) && !!node.term.trim();

  function broadcastQuery() {
    for (const frame of [byId('knowledge-library-tree-frame'), byId('knowledge-portal-frame')]) {
      frame?.contentWindow?.postMessage({
        channel: CHANNEL, version: 2, type: 'query-changed', query: currentQuery,
      }, window.location.origin);
    }
  }

  function deliverNode() {
    if (treeReady && pendingNode) byId('knowledge-library-tree-frame')?.contentWindow?.postMessage({
      channel: CHANNEL, version: 2, type: 'open-map-node', node: pendingNode,
    }, window.location.origin);
  }

  function bridgeError(message) {
    const status = byId('knowledge-library-status');
    if (status) { status.hidden = false; status.textContent = message; }
  }

  function validReadingRequest(message) {
    if (!exactKeys(message,['channel','version','type','requestId','operation','data']) ||
      message.channel !== CHANNEL || message.version !== 2 || message.type !== 'reading-request' ||
      typeof message.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(message.requestId)) return false;
    if (message.operation === 'status') return exactKeys(message.data,[]);
    const data = message.data;
    return message.operation === 'turn' && exactKeys(data,['eventId','documentId','fromPage','toPage']) &&
      typeof data.eventId === 'string' && /^[a-f0-9-]{36}$/.test(data.eventId) &&
      typeof data.documentId === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(data.documentId) &&
      Number.isSafeInteger(data.fromPage) && data.fromPage >= 1 && data.fromPage <= 1000000 &&
      Number.isSafeInteger(data.toPage) && data.toPage >= 1 && data.toPage <= 1000000 &&
      Math.abs(data.toPage - data.fromPage) === 1;
  }

  async function handleReading(message, source) {
    if (readingRequests.has(message.requestId)) return;
    readingRequests.add(message.requestId);
    try {
      if (readingRequests.size > 4) throw new Error('Počkaj na potvrdenie predchádzajúceho otočenia.');
      const result = message.operation === 'status'
        ? await window.MOAuth.api('/api/knowledge/grimoire/reading')
        : await window.MOAuth.recordReadingTurn(message.data);
      source.postMessage({channel:CHANNEL,version:2,type:'reading-response',requestId:message.requestId,
        ok:true,error:'',result},window.location.origin);
    } catch (error) {
      source.postMessage({channel:CHANNEL,version:2,type:'reading-response',requestId:message.requestId,
        ok:false,error:String(error.message || 'Otočenie sa nepotvrdilo.').slice(0,2000),result:null},window.location.origin);
    } finally { readingRequests.delete(message.requestId); }
  }

  function validSearchRequest(message) {
    return exactKeys(message, ['channel', 'version', 'type', 'requestId', 'operation', 'documentId', 'query']) &&
      message.channel === CHANNEL && message.version === 2 && message.type === 'search-request' &&
      typeof message.requestId === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(message.requestId) &&
      ['search', 'open-search'].includes(message.operation) &&
      typeof message.documentId === 'string' && (message.operation === 'search'
        ? message.documentId === '' : /^[a-zA-Z0-9_.:-]{1,160}$/.test(message.documentId)) &&
      validText(message.query, 150);
  }

  function validTerminologyRequest(message) {
    if (!exactKeys(message, ['channel','version','type','requestId','operation','data']) ||
      message.channel !== CHANNEL || message.version !== 2 || message.type !== 'terminology-request' ||
      typeof message.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(message.requestId)) return false;
    const data = message.data;
    const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value);
    if (message.operation === 'list') return exactKeys(data, []);
    if (message.operation === 'create' || message.operation === 'save') {
      const keys = message.operation === 'create' ? ['creationKey','details'] : ['id','expectedRevision','details'];
      if (!exactKeys(data, keys) || (message.operation === 'create' ? !id(data.creationKey)
        : !id(data.id) || !Number.isSafeInteger(data.expectedRevision) || data.expectedRevision < 1)) return false;
      const value = data.details;
      return (exactKeys(value, ['fieldId','categoryId','term','description','note','documentIds','folderIds','collectionIds']) ||
        exactKeys(value, ['fieldId','categoryId','term','description','note','documentIds','folderIds','collectionIds','parent']) &&
          (value.parent === null || exactKeys(value.parent,['termId']) && id(value.parent.termId) ||
            exactKeys(value.parent,['term']) && validText(value.parent.term,150) && !!value.parent.term.trim())) &&
        id(value.fieldId) && id(value.categoryId) && validText(value.term,150) && !!value.term.trim() &&
        typeof value.description === 'string' && value.description.length <= 2000 &&
        typeof value.note === 'string' && value.note.length <= 500 &&
        ['documentIds','folderIds','collectionIds'].every(key => Array.isArray(value[key]) &&
          value[key].length <= 10000 && value[key].every(id));
    }
    if (message.operation === 'term-folder') return exactKeys(data,['id','mapDocumentIds']) && id(data.id) &&
      Array.isArray(data.mapDocumentIds) && data.mapDocumentIds.length > 0 && data.mapDocumentIds.length <= 100 &&
      data.mapDocumentIds.every(id);
    if (message.operation === 'legacy-note') return exactKeys(data,['id','note']) && id(data.id) && typeof data.note === 'string' && data.note.length <= 500;
    if (message.operation === 'legacy-collection') return exactKeys(data,['id','parentTabId']) && id(data.id) && (data.parentTabId === null || id(data.parentTabId));
    if (message.operation === 'legacy-details') return exactKeys(data,['id','title','note']) && id(data.id) &&
      validText(data.title,120) && !!data.title.trim() && typeof data.note === 'string' && data.note.length <= 500;
    if (['legacy-include','legacy-exclude','legacy-folder'].includes(message.operation)) return exactKeys(data,['id','targetId']) && id(data.id) && id(data.targetId);
    return false;
  }

  async function handleTerminology(message, source) {
    if (terminologyRequests.has(message.requestId)) return;
    if (terminologyRequests.size >= 20) {
      source.postMessage({channel:CHANNEL,version:2,type:'document-response',requestId:message.requestId,
        ok:false,error:'Priveľa súbežných požiadaviek terminológie. Skús znova.',result:null},window.location.origin);
      return;
    }
    terminologyRequests.add(message.requestId);
    try {
      const result = message.operation === 'list'
        ? await window.MOAuth.api('/api/knowledge/grimoire/terminology')
        : await window.MOAuth.mutateTerminology({ operation: message.operation, ...message.data });
      source.postMessage({ channel:CHANNEL,version:2,type:'document-response',requestId:message.requestId,
        ok:true,error:'',result }, window.location.origin);
      for (const frame of [byId('knowledge-library-tree-frame'),byId('knowledge-portal-frame')]) {
        if (message.operation !== 'list' && frame?.contentWindow !== source) frame?.contentWindow?.postMessage({
          channel:CHANNEL,version:2,type:'refresh-catalog'
        },window.location.origin);
      }
    } catch (error) {
      source.postMessage({channel:CHANNEL,version:2,type:'document-response',requestId:message.requestId,
        ok:false,error:String(error.message || 'Terminológia sa neuložila.').slice(0,2000),result:null},window.location.origin);
    } finally { terminologyRequests.delete(message.requestId); }
  }

  function loadFrame(mode) {
    const grimoire = byId('knowledge-library-grimoire-frame');
    const tree = byId('knowledge-library-tree-frame');
    if (mode === 'grimoire' && !grimoireLoaded) {
      grimoireLoaded = true;
      grimoire.loading = 'eager';
      grimoire.src = '/knowledge/index.html?entry=local-game-2';
    }
    if (mode === 'tree' && !treeLoaded) {
      treeLoaded = true;
      tree.src = '/knowledge-system/index.html?embed=1';
    }
  }

  function updateMode() {
    const host = byId('knowledge-library-host');
    if (host) host.dataset.mode = mode;
  }

  function updateContext() {
    const label = byId('knowledge-library-context');
    const status = byId('knowledge-library-status');
    if (label) {
      label.hidden = !selectedContext;
      label.textContent = selectedContext
        ? `Vybraný pojem z mapy: ${selectedContext.term}${[selectedContext.sefirah, selectedContext.field, selectedContext.category].filter(Boolean).length
          ? ` · ${[selectedContext.sefirah, selectedContext.field, selectedContext.category].filter(Boolean).join(' → ')}`
          : ''}`
        : '';
    }
    if (status) {
      status.hidden = !pendingSearch;
      status.textContent = pendingSearch
        ? 'Pojem je pripravený. Čakám na pripojenie Grimoára k miestnemu účtu hry.'
        : '';
    }
  }

  function deliverSearch() {
    if (!pendingSearch || !grimoireReady) return;
    const frame = byId('knowledge-library-grimoire-frame');
    frame?.contentWindow?.postMessage({
      channel: CHANNEL, version: 1, type: 'search', query: pendingSearch,
    }, window.location.origin);
    pendingSearch = null;
    updateContext();
  }

  function validDocumentRequest(message) {
    if (!exactKeys(message, ['channel', 'version', 'type', 'requestId', 'operation', 'documentId', 'node']) ||
      message.channel !== CHANNEL || message.version !== 2 || message.type !== 'document-request' ||
      typeof message.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(message.requestId) ||
      !['catalog', 'link', 'unlink', 'open', 'open-map'].includes(message.operation) ||
      typeof message.documentId !== 'string' ||
      (message.operation === 'catalog' ? message.documentId !== '' : !/^[a-zA-Z0-9_.:-]{1,160}$/.test(message.documentId))) return false;
    if (message.operation === 'link' || message.operation === 'unlink') {
      return exactKeys(message.node, ['fieldId', 'categoryId', 'term']) &&
        typeof message.node.fieldId === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(message.node.fieldId) &&
        typeof message.node.categoryId === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(message.node.categoryId) &&
        validText(message.node.term, 150) && !!message.node.term.trim();
    }
    return message.node === null;
  }

  function deliverDocumentRequests() {
    if (!grimoireReady) return;
    const frame = byId('knowledge-library-grimoire-frame');
    for (const pending of documentRequests.values()) {
      if (pending.sent) continue;
      pending.sent = true;
      frame.contentWindow.postMessage(pending.message, window.location.origin);
    }
  }

  function validTreeMessage(message) {
    if (!exactKeys(message, ['channel', 'version', 'type', 'query', 'context'])
      || message.channel !== CHANNEL || message.version !== 1 || message.type !== 'search-term'
      || !validText(message.query, 150) || !message.query.trim() || message.query !== message.query.trim()
      || !exactKeys(message.context, ['term', 'sefirah', 'field', 'category'])
      || message.context.term !== message.query
      || !validText(message.context.term, 150)
      || !validText(message.context.sefirah, 80)
      || !validText(message.context.field, 120)
      || !validText(message.context.category, 120)) return false;
    return true;
  }

  function receiveMessage(event) {
    if (event.origin !== window.location.origin) return;
    const grimoire = byId('knowledge-library-grimoire-frame');
    const tree = byId('knowledge-library-tree-frame');
    const profileMap = byId('knowledge-portal-frame');
    if (event.source === grimoire?.contentWindow) {
      if (validReadingRequest(event.data)) { void handleReading(event.data,event.source); return; }
      if (exactKeys(event.data, ['channel', 'version', 'type', 'query']) &&
        event.data.channel === CHANNEL && event.data.version === 2 && event.data.type === 'query-changed' &&
        validText(event.data.query, 150)) {
        currentQuery = event.data.query; broadcastQuery(); return;
      }
      if (exactKeys(event.data, ['channel', 'version', 'type', 'node']) &&
        event.data.channel === CHANNEL && event.data.version === 2 && event.data.type === 'open-map-node' &&
        validNode(event.data.node)) {
        clearTimeout(nodeTimer);
        pendingNode = null;
        mode = 'tree';
        window.MOApp?.navigate('library/tree');
        pendingNode = event.data.node;
        nodeTimer = setTimeout(() => { pendingNode = null; bridgeError('Mapa neodpovedala. Uzol sa neotvoril.'); }, 25000);
        loadFrame('tree'); deliverNode(); return;
      }
      if (exactKeys(event.data, ['channel', 'version', 'type', 'requestId', 'ok', 'error', 'result']) &&
        event.data.channel === CHANNEL && event.data.version === 2 && event.data.type === 'document-response' &&
        typeof event.data.ok === 'boolean' && validText(event.data.error, 2000)) {
        const pending = documentRequests.get(event.data.requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        documentRequests.delete(event.data.requestId);
        if (['open', 'open-map', 'open-search'].includes(pending.message.operation) && pending.navigationRevision !== navigationRevision) {
          pending.source.postMessage({
            ...event.data, ok: false, error: 'Otvorenie nahradila novšia navigácia. Rozpísaný obsah zostal zachovaný.', result: null,
          }, window.location.origin);
          return;
        }
        if (event.data.ok && ['open', 'open-map', 'open-search'].includes(pending.message.operation)) {
          mode = 'grimoire';
          window.MOApp?.navigate('library/grimoire');
        }
        pending.source.postMessage(event.data, window.location.origin);
        return;
      }
      if (exactKeys(event.data, ['channel', 'version', 'type'])
        && event.data.channel === CHANNEL && event.data.version === 1 && event.data.type === 'ready') {
        grimoireReady = true;
        deliverSearch();
        deliverDocumentRequests();
      }
      return;
    }
    if (event.source !== tree?.contentWindow && event.source !== profileMap?.contentWindow) return;
    if (validTerminologyRequest(event.data) && !event.data.operation.startsWith('legacy-') && event.data.operation !== 'term-folder') {
      void handleTerminology(event.data,event.source);
      return;
    }
    if (exactKeys(event.data, ['channel', 'version', 'type']) &&
      event.data.channel === CHANNEL && event.data.version === 2 && event.data.type === 'map-ready') {
      broadcastQuery();
      if (event.source === tree?.contentWindow) { treeReady = true; deliverNode(); }
      return;
    }
    if (event.source === tree?.contentWindow &&
      exactKeys(event.data, ['channel', 'version', 'type', 'node', 'ok', 'error']) &&
      event.data.channel === CHANNEL && event.data.version === 2 && event.data.type === 'node-response' &&
      validNode(event.data.node) && typeof event.data.ok === 'boolean' && validText(event.data.error, 2000)) {
      if (!pendingNode || ['fieldId', 'categoryId', 'term'].some(key => pendingNode[key] !== event.data.node[key])) return;
      clearTimeout(nodeTimer); pendingNode = null;
      if (!event.data.ok) bridgeError(event.data.error);
      else {
        const status = byId('knowledge-library-status');
        if (status) { status.hidden = true; status.textContent = ''; }
      }
      return;
    }
    if (validDocumentRequest(event.data) || validSearchRequest(event.data) || validTerminologyRequest(event.data)) {
      if (validSearchRequest(event.data)) currentQuery = event.data.query;
      if (documentRequests.has(event.data.requestId)) return;
      if (documentRequests.size >= 20) {
        event.source.postMessage({
          channel: CHANNEL, version: 2, type: 'document-response', requestId: event.data.requestId,
          ok: false, error: 'Grimoár má priveľa súbežných požiadaviek. Skús znova.', result: null,
        }, window.location.origin);
        return;
      }
      const pending = { message: event.data, source: event.source, sent: false, timer: null, navigationRevision };
      pending.timer = setTimeout(() => {
        documentRequests.delete(event.data.requestId);
        pending.source.postMessage({
          channel: CHANNEL, version: 2, type: 'document-response', requestId: event.data.requestId,
          ok: false, error: 'Grimoár neodpovedal. Skontroluj jeho pripojenie a skús znova.', result: null,
        }, window.location.origin);
      }, 25000);
      documentRequests.set(event.data.requestId, pending);
      loadFrame('grimoire');
      deliverDocumentRequests();
      return;
    }
    if (!validTreeMessage(event.data)) return;
    pendingSearch = event.data.query;
    selectedContext = { ...event.data.context };
    mode = 'grimoire';
    window.MOApp?.navigate('library/grimoire');
    updateContext();
    loadFrame(mode);
    deliverSearch();
  }

  function setMode(nextMode) {
    if (!MODES.includes(nextMode)) return false;
    mode = nextMode;
    window.MOApp?.navigate('library/' + nextMode);
    return true;
  }

  function openSearch(query) {
    if (!validText(query, 150) || !query.trim() || query !== query.trim()) return false;
    const host = byId('knowledge-library-host');
    const alreadyOpen = !!host && !host.hidden && mode === 'grimoire';
    mode = 'grimoire';
    pendingSearch = query;
    selectedContext = null;
    updateContext();
    if (!alreadyOpen) window.MOApp?.navigate('library/grimoire');
    loadFrame(mode);
    deliverSearch();
    return true;
  }

  function handleAction(action, element) {
    if (action === 'library-area') return setMode(element.dataset.libraryArea);
    if (action === 'knowledge-clear-context') {
      selectedContext = null;
      pendingSearch = null;
      updateContext();
      return true;
    }
    return false;
  }

  function afterRender(view) {
    navigationRevision += 1;
    if (pendingNode) {
      clearTimeout(nodeTimer); pendingNode = null;
      bridgeError('Otvorenie uzla nahradila novšia navigácia.');
    }
    for (const [requestId, pending] of documentRequests) {
      if (!['open', 'open-map', 'open-search'].includes(pending.message.operation)) continue;
      byId('knowledge-library-grimoire-frame')?.contentWindow?.postMessage({
        channel: CHANNEL, version: 2, type: 'document-cancel', requestId,
      }, window.location.origin);
      clearTimeout(pending.timer);
      documentRequests.delete(requestId);
      pending.source.postMessage({
        channel: CHANNEL, version: 2, type: 'document-response', requestId,
        ok: false, error: 'Otvorenie nahradila novšia navigácia. Rozpísaný obsah zostal zachovaný.', result: null,
      }, window.location.origin);
    }
    const active = view === 'library' && ['grimoire', 'tree'].includes(mode);
    const host = byId('knowledge-library-host');
    const main = byId('main');
    if (host) host.hidden = !active;
    if (main) main.hidden = active;
    document.body.classList.toggle('knowledge-library-open', active);
    updateMode();
    if (active) {
      loadFrame(mode);
      if (mode === 'tree' && treeReady) byId('knowledge-library-tree-frame')?.contentWindow?.postMessage({
        channel: CHANNEL, version: 2, type: 'refresh-catalog',
      }, window.location.origin);
    }
  }

  function deactivate() {
    const host = byId('knowledge-library-host');
    const main = byId('main');
    if (host) host.hidden = true;
    if (main) main.hidden = false;
    document.body.classList.remove('knowledge-library-open');
  }

  window.addEventListener('message', receiveMessage);
  window.MOKnowledgeLibrary = Object.freeze({
    afterRender,
    deactivate,
    handleAction,
    mode: () => mode,
    syncRoute(hash) {
      if (hash === '#library') mode = 'room';
      else if (/^#library\/(books|grimoire|tree)$/.test(hash)) mode = hash.slice(9);
    },
    openSearch,
  });
})();
