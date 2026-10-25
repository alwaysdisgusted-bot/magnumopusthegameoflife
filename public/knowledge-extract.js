(function (root) {
  'use strict';

  var MAX_BYTES = 15 * 1024 * 1024;
  var MAX_ZIP_BYTES = 25 * 1024 * 1024;
  var MAX_TEXT = 200000;
  var MAX_PDF_PAGES = 60;
  var generation = 0;
  var active = null;
  var versionsPromise = null;
  var pdfPromise = null;
  var zipPromise = null;
  var WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var WORD_STRICT_NS = 'http://purl.oclc.org/ooxml/wordprocessingml/main';

  function abortError() {
    var error = new Error('Spracovanie bolo zrušené.');
    error.name = 'AbortError';
    return error;
  }

  function ignore(promise) { return Promise.resolve(promise).catch(function () {}); }

  function cancel() {
    generation += 1;
    var previous = active;
    active = null;
    if (previous) {
      previous.controller.abort();
      if (previous.render) { try { previous.render.cancel(); } catch (_) {} }
      if (previous.pdfTask) { try { ignore(previous.pdfTask.destroy()); } catch (_) {} }
    }
    return root.MOPhotoOCR && typeof root.MOPhotoOCR.cancel === 'function' ? ignore(root.MOPhotoOCR.cancel()) : Promise.resolve();
  }

  function begin(onProgress) {
    var stopped = cancel();
    var operation = { generation: generation, controller: new root.AbortController(), pdfTask: null, render: null, stopped: stopped };
    operation.check = function () { if (operation.generation !== generation || operation.controller.signal.aborted) throw abortError(); };
    operation.progress = function (message) {
      operation.check();
      if (typeof onProgress === 'function') { try { onProgress(message); } catch (_) {} }
    };
    active = operation;
    return operation;
  }

  function asset(path, version) {
    var url = new root.URL('/vendor/knowledge/' + path, root.location.href);
    if (version) url.searchParams.set('v', version);
    return url.href;
  }

  function versions() {
    if (!versionsPromise) versionsPromise = root.fetch(asset('versions.json'), { credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('Miestne nástroje na čítanie dokumentov nie sú pripravené.');
      return response.json();
    }).then(function (value) {
      if (!value || !/^[\d.]+(?:-[\w.]+)?$/.test(value.pdfjs || '') || !/^[\d.]+(?:-[\w.]+)?$/.test(value.fflate || '')) throw new Error('Miestne nástroje na čítanie dokumentov nie sú pripravené.');
      return value;
    }).catch(function (error) { versionsPromise = null; throw error; });
    return versionsPromise;
  }

  function pdfLibrary() {
    if (root.pdfjsLib && typeof root.pdfjsLib.getDocument === 'function') return Promise.resolve(root.pdfjsLib);
    if (!pdfPromise) pdfPromise = versions().then(async function (value) {
      var library = await import(asset('pdf.mjs', value.pdfjs));
      if (library.version !== value.pdfjs) throw new Error('Verzia miestneho PDF nástroja sa nezhoduje. Obnov stránku.');
      library.GlobalWorkerOptions.workerSrc = asset('pdf.worker.mjs', library.version);
      return library;
    }).catch(function (error) { pdfPromise = null; throw error; });
    return pdfPromise;
  }

  function zipLibrary() {
    if (root.fflate && typeof root.fflate.unzipSync === 'function') return Promise.resolve(root.fflate);
    if (!zipPromise) zipPromise = versions().then(function (value) {
      return new Promise(function (resolve, reject) {
        var script = root.document.createElement('script');
        var settled = false;
        var timer = root.setTimeout(function () { finish(new Error('Miestny nástroj DOCX sa nepodarilo načítať.')); }, 30000);
        function finish(error) {
          if (settled) return;
          settled = true;
          root.clearTimeout(timer);
          script.onload = script.onerror = null;
          if (error) { script.remove(); reject(error); } else resolve(root.fflate);
        }
        script.src = asset('fflate.js', value.fflate);
        script.async = true;
        script.onload = function () { finish(root.fflate && typeof root.fflate.unzipSync === 'function' ? null : new Error('Miestny nástroj DOCX nie je dostupný.')); };
        script.onerror = function () { finish(new Error('Miestny nástroj DOCX sa nepodarilo načítať.')); };
        root.document.head.appendChild(script);
      });
    }).catch(function (error) { zipPromise = null; throw error; });
    return zipPromise;
  }

  function normalized(text) { return String(text || '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim(); }

  function clipText(text, limit) {
    text = text.slice(0, Math.max(0, limit));
    return /^[\uD800-\uDBFF]$/.test(text.slice(-1)) ? text.slice(0, -1) : text;
  }

  function result(text, mime, warnings, pageRecords) {
    text = normalized(text);
    warnings = warnings || [];
    if (text.length > MAX_TEXT) {
      text = clipText(text, MAX_TEXT);
      warnings.push('Text presahuje 200 000 znakov. Uložený prepis je skrátený; zvyšok doplň alebo rozdeľ dokument.');
    }
    var pages;
    if (pageRecords) {
      var remaining = MAX_TEXT, hasText = false;
      pages = pageRecords.map(function (page) {
        var value = normalized(page.text);
        var separator = hasText && value ? 2 : 0;
        value = clipText(value, remaining - separator);
        if (value) { remaining -= value.length + separator; hasText = true; }
        return { number: page.number, text: value };
      });
      text = normalized(pages.filter(function (page) { return !!page.text; }).map(function (page) { return page.text; }).join('\n\n'));
    } else pages = [{ number: 1, text: text }];
    if (!text) warnings.push('Čitateľný text sa nenašiel. Doplň ho ručne alebo použi čitateľnejší podklad.');
    return { text: text, mime: mime, status: warnings.length ? 'needs_text' : 'indexed', warning: warnings.join(' '), pages: pages, pagination: mime === 'application/pdf' ? 'pages' : 'unpaginated' };
  }

  function sizeCheck(file) {
    if (!file || typeof file.arrayBuffer !== 'function' || !Number.isFinite(file.size) || file.size < 0) throw new Error('Vyber platný súbor.');
    if (file.size > MAX_BYTES) throw new Error('Súbor môže mať najviac 15 MB.');
  }

  function kindOf(file) {
    var extension = /\.([^.]+)$/.exec(file.name || '');
    extension = extension ? extension[1].toLowerCase() : '';
    var byExtension = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
    var mime = (file.type || '').toLowerCase().split(';')[0].trim();
    if (extension && !byExtension[extension]) throw new Error('Použi PDF, DOCX, TXT, Markdown, JPG, PNG alebo WebP.');
    var kind = byExtension[extension] || (Object.values(byExtension).indexOf(mime) >= 0 ? mime : '');
    if (!kind) throw new Error('Použi PDF, DOCX, TXT, Markdown, JPG, PNG alebo WebP.');
    return kind;
  }

  function decodeText(bytes, xml) {
    var encoding = 'utf-8';
    if (bytes[0] === 255 && bytes[1] === 254) encoding = 'utf-16le';
    else if (bytes[0] === 254 && bytes[1] === 255) encoding = 'utf-16be';
    var value;
    try { value = new root.TextDecoder(encoding, { fatal: true }).decode(bytes); }
    catch (_) { throw new Error('Text musí byť uložený ako UTF-8 alebo UTF-16 s označením kódovania.'); }
    if (!xml && /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) throw new Error('Súbor neobsahuje platný text. Vyber PDF, DOCX, TXT alebo Markdown.');
    return value;
  }

  function validImage(bytes, mime) {
    if (mime === 'image/png') return bytes.length >= 24 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10;
    if (mime === 'image/jpeg') return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    return bytes.length >= 30 && String.fromCharCode.apply(null, bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode.apply(null, bytes.subarray(8, 12)) === 'WEBP';
  }

  async function photoText(file, mime, operation) {
    operation.check();
    var ocr = root.MOPhotoOCR;
    if (!ocr || typeof ocr.resize !== 'function' || typeof ocr.recognize !== 'function') throw new Error('Miestny prepis fotografií nie je dostupný.');
    operation.progress('Pripravujem fotografiu na prepis…');
    var blob = file.type === mime ? file : new root.Blob([file], { type: mime });
    var prepared = await ocr.resize(blob, 2400);
    operation.check();
    var text = await ocr.recognize(prepared, operation.progress);
    operation.check();
    return normalized(text);
  }

  async function readPhotoSource(source, operation) {
    if (typeof source !== 'string') { sizeCheck(source); return source; }
    if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(source)) {
      if (source.length > MAX_BYTES * 4 / 3 + 100) throw new Error('Fotografia môže mať najviac 15 MB.');
    } else {
      var url;
      try { url = new root.URL(source, root.location.href); } catch (_) { throw new Error('Fotografia musí byť z miestnej hry.'); }
      if (url.origin !== root.location.origin || !/^\/(?:api|assets)\//.test(url.pathname) || url.username || url.password || !/^https?:$/.test(url.protocol)) throw new Error('Fotografia musí byť z miestnej hry.');
      source = url.href;
    }
    operation.check();
    var response = await root.fetch(source, { credentials: 'same-origin', mode: 'same-origin', redirect: 'error', signal: operation.controller.signal });
    operation.check();
    if (!response.ok) throw new Error('Fotografiu sa nepodarilo načítať z miestnej hry.');
    var length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > MAX_BYTES) throw new Error('Fotografia môže mať najviac 15 MB.');
    var mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!/^image\/(?:png|jpeg|webp)$/.test(mime)) throw new Error('Vyber fotografiu JPG, PNG alebo WebP.');
    var chunks = [], total = 0;
    if (response.body && typeof response.body.getReader === 'function') {
      var reader = response.body.getReader();
      try {
        while (true) {
          var part = await reader.read();
          operation.check();
          if (part.done) break;
          total += part.value.byteLength;
          if (total > MAX_BYTES) throw new Error('Fotografia môže mať najviac 15 MB.');
          chunks.push(part.value);
        }
      } finally { ignore(reader.cancel()); }
    } else {
      var buffer = await response.arrayBuffer();
      operation.check();
      if (buffer.byteLength > MAX_BYTES) throw new Error('Fotografia môže mať najviac 15 MB.');
      chunks.push(buffer);
    }
    return new root.Blob(chunks, { type: mime });
  }

  function zipEntries(bytes) {
    function invalid() { throw new Error('DOCX je poškodený alebo nepodporovaný. Použi platný dokument DOCX.'); }
    if (bytes.length < 22) invalid();
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var end = -1;
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
      if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
    }
    if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) invalid();
    var count = view.getUint16(end + 10, true), cursor = view.getUint32(end + 16, true), centralSize = view.getUint32(end + 12, true);
    if (!count || count > 4096 || count === 65535 || count !== view.getUint16(end + 8, true) || cursor + centralSize !== end) invalid();
    var total = 0, entries = new Map();
    for (var item = 0; item < count; item += 1) {
      if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) invalid();
      var flags = view.getUint16(cursor + 8, true), compression = view.getUint16(cursor + 10, true), compressed = view.getUint32(cursor + 20, true), original = view.getUint32(cursor + 24, true);
      var nameLength = view.getUint16(cursor + 28, true), extraLength = view.getUint16(cursor + 30, true), commentLength = view.getUint16(cursor + 32, true), offset = view.getUint32(cursor + 42, true);
      var next = cursor + 46 + nameLength + extraLength + commentLength;
      if (next > end || !nameLength || flags & 1 || (compression !== 0 && compression !== 8) || compressed === 0xffffffff || original === 0xffffffff || view.getUint16(cursor + 34, true)) invalid();
      total += original;
      if (total > MAX_ZIP_BYTES) throw new Error('Rozbalený DOCX môže mať najviac 25 MB. Rozdeľ dokument na menšie časti.');
      var name = decodeText(bytes.subarray(cursor + 46, cursor + 46 + nameLength), true);
      if (entries.has(name) || name.indexOf('\\') >= 0 || name[0] === '/' || name.split('/').indexOf('..') >= 0 || offset + 30 > view.getUint32(end + 16, true) || view.getUint32(offset, true) !== 0x04034b50) invalid();
      var dataOffset = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
      if (dataOffset + compressed > view.getUint32(end + 16, true) || view.getUint16(offset + 8, true) !== compression || (view.getUint16(offset + 6, true) & 1)) invalid();
      entries.set(name, { size: compressed, originalSize: original, compression: compression, crc: view.getUint32(cursor + 16, true) });
      cursor = next;
    }
    if (cursor !== end || !entries.has('[Content_Types].xml') || !entries.has('word/document.xml')) invalid();
    return entries;
  }

  function crc32(bytes) {
    var crc = -1;
    for (var i = 0; i < bytes.length; i += 1) {
      crc ^= bytes[i];
      for (var bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ -1) >>> 0;
  }

  function xmlParagraphs(bytes, name) {
    var xml = decodeText(bytes, true);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DOCX obsahuje nepodporované XML deklarácie.');
    var document = new root.DOMParser().parseFromString(xml, 'application/xml');
    if (document.getElementsByTagName('parsererror').length || document.getElementsByTagNameNS('*', 'parsererror').length) throw new Error('Textová časť DOCX je poškodená.');
    function isWord(node) { return node.namespaceURI === WORD_NS || node.namespaceURI === WORD_STRICT_NS; }
    if (name === 'word/document.xml' && (!isWord(document.documentElement) || document.documentElement.localName !== 'document')) throw new Error('Súbor neobsahuje platný dokument DOCX.');
    Array.from(document.getElementsByTagNameNS('*', 'script')).forEach(function (node) { node.remove(); });
    var paragraphs = Array.from(document.getElementsByTagName('*')).filter(function (node) { return isWord(node) && node.localName === 'p'; });
    return paragraphs.map(function (paragraph) {
      var pieces = [];
      function walk(node) {
        if (isWord(node) && node.localName === 't') { pieces.push(node.textContent); return; }
        if (isWord(node) && (node.localName === 'br' || node.localName === 'cr')) { pieces.push('\n'); return; }
        if (isWord(node) && node.localName === 'tab') { pieces.push('\t'); return; }
        if (node !== paragraph && isWord(node) && node.localName === 'p') return;
        Array.from(node.childNodes || []).forEach(walk);
      }
      walk(paragraph);
      return pieces.join('');
    }).join('\n');
  }

  async function docxText(bytes, mime, operation) {
    operation.progress('Čítam text dokumentu DOCX…');
    var entries = zipEntries(bytes);
    var library = await zipLibrary();
    operation.check();
    var parts;
    try {
      parts = library.unzipSync(bytes, { filter: function (entry) {
        var expected = entries.get(entry.name);
        if (!expected || entry.size !== expected.size || entry.originalSize !== expected.originalSize || entry.compression !== expected.compression) throw new Error('Neplatné metadáta DOCX.');
        return /^(?:\[Content_Types\]\.xml|word\/(?:document|footnotes|endnotes|header\d*|footer\d*)\.xml)$/.test(entry.name);
      } });
    } catch (_) { throw new Error('DOCX sa nepodarilo bezpečne rozbaliť. Vyber platný dokument DOCX.'); }
    operation.check();
    var names = Object.keys(parts).filter(function (name) { return name !== '[Content_Types].xml'; }).sort(function (left, right) { return left === 'word/document.xml' ? -1 : right === 'word/document.xml' ? 1 : left.localeCompare(right); });
    var text = [], warnings = [];
    names.forEach(function (name) {
      operation.check();
      if (parts[name].length !== entries.get(name).originalSize || crc32(parts[name]) !== entries.get(name).crc) throw new Error('Textová časť DOCX je poškodená.');
      text.push(xmlParagraphs(parts[name], name));
    });
    if (Array.from(entries.keys()).some(function (name) { return /^word\/(?:media|embeddings)\//.test(name); })) warnings.push('DOCX obsahuje obrázky alebo vložené prílohy. Ich text nie je v prepise; podľa potreby ho doplň.');
    return result(text.join('\n\n'), mime, warnings);
  }

  function pageText(content) {
    var pieces = [];
    (content.items || []).forEach(function (item) {
      if (typeof item.str !== 'string') return;
      pieces.push(item.str);
      pieces.push(item.hasEOL ? '\n' : ' ');
    });
    return normalized(pieces.join(''));
  }

  async function scannedPage(page, operation, label) {
    var viewport = page.getViewport({ scale: 1 });
    if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) throw new Error('Neplatná strana PDF.');
    var scale = Math.min(2.5, 2400 / Math.max(viewport.width, viewport.height));
    viewport = page.getViewport({ scale: scale });
    var canvas = root.document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    if (canvas.width * canvas.height > 6000000) throw new Error('Strana PDF je príliš veľká.');
    try {
      var context = canvas.getContext('2d');
      if (!context) throw new Error('Prehliadač nedokázal pripraviť stranu PDF.');
      operation.render = page.render({ canvasContext: context, viewport: viewport, background: '#ffffff', annotationMode: 0, isEditing: false });
      await operation.render.promise;
      operation.check();
      operation.render = null;
      var ocr = root.MOPhotoOCR;
      if (!ocr || typeof ocr.recognize !== 'function') throw new Error('Miestny prepis nie je dostupný.');
      var text = await ocr.recognize(canvas.toDataURL('image/jpeg', 0.88), function (message) { operation.progress(label + ' · ' + message); });
      operation.check();
      return normalized(text);
    } finally { operation.render = null; canvas.width = canvas.height = 1; }
  }

  async function pdfText(bytes, mime, operation) {
    if (new root.TextDecoder('ascii').decode(bytes.subarray(0, Math.min(1024, bytes.length))).indexOf('%PDF-') < 0) throw new Error('Vybraný súbor nie je platné PDF.');
    operation.progress('Otváram miestny dokument PDF…');
    var library = await pdfLibrary();
    operation.check();
    var task = library.getDocument({ data: bytes, isEvalSupported: false, enableXfa: false, useSystemFonts: true, cMapUrl: asset('cmaps/'), cMapPacked: true, standardFontDataUrl: asset('standard_fonts/'), wasmUrl: asset('wasm/'), iccUrl: asset('iccs/'), useWorkerFetch: true, disableAutoFetch: true });
    operation.pdfTask = task;
    var pages = [], pageRecords = [], warnings = [], pdf;
    try {
      pdf = await task.promise;
      operation.check();
      var count = Math.min(pdf.numPages, MAX_PDF_PAGES);
      if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1) throw new Error('PDF nemá čitateľné strany.');
      if (pdf.numPages > MAX_PDF_PAGES) warnings.push('PDF má ' + pdf.numPages + ' strán. Spracovaných je najviac prvých ' + MAX_PDF_PAGES + '; zvyšok doplň alebo rozdeľ dokument.');
      var unread = [];
      var totalLength = 0;
      for (var number = 1; number <= count; number += 1) {
        operation.check();
        var label = 'Strana ' + number + ' z ' + pdf.numPages;
        operation.progress('Čítam PDF · ' + label + '…');
        var page;
        var pageRecord = { number: number, text: '' };
        pageRecords.push(pageRecord);
        try {
          page = await pdf.getPage(number);
          operation.check();
          var text = pageText(await page.getTextContent({ disableNormalization: false }));
          operation.check();
          if (!text) {
            operation.progress('Prepisujem naskenované PDF · ' + label + '…');
            text = await scannedPage(page, operation, label);
          }
          if (text) { pages.push(text); pageRecord.text = text; totalLength += text.length + 2; } else unread.push(number);
        } catch (error) {
          operation.check();
          if (error && error.name === 'AbortError') throw error;
          unread.push(number);
        } finally { if (page && typeof page.cleanup === 'function') page.cleanup(); }
        if (totalLength > MAX_TEXT) {
          if (number < count) warnings.push('Prepis dosiahol limit 200 000 znakov; strany ' + (number + 1) + ' až ' + pdf.numPages + ' neboli spracované.');
          break;
        }
      }
      if (unread.length) warnings.push('Text sa nepodarilo prečítať na stranách: ' + unread.join(', ') + '. Skontroluj ich a doplň text ručne.');
      return result(pages.join('\n\n'), mime, warnings, pageRecords);
    } catch (error) {
      operation.check();
      if (error && error.name === 'AbortError') throw error;
      if (error && error.name === 'PasswordException') return result('', mime, ['PDF je chránené heslom. Nahraj odomknutú kópiu alebo doplň text ručne.'], []);
      throw new Error('PDF sa nepodarilo prečítať. Skontroluj súbor alebo doplň text ručne.');
    } finally {
      if (operation.pdfTask === task) operation.pdfTask = null;
      try { await ignore(task.destroy()); } catch (_) {}
    }
  }

  async function extract(file, onProgress) {
    var operation = begin(onProgress);
    try {
      sizeCheck(file);
      var mime = kindOf(file);
      await operation.stopped;
      operation.check();
      operation.progress('Čítam súbor v tomto počítači…');
      var bytes = new Uint8Array(await file.arrayBuffer());
      operation.check();
      if (bytes.length > MAX_BYTES || bytes.length !== file.size) throw new Error('Súbor je príliš veľký alebo sa počas čítania zmenil.');
      var answer;
      if (mime === 'application/pdf') answer = await pdfText(bytes, mime, operation);
      else if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') answer = await docxText(bytes, mime, operation);
      else if (mime === 'text/plain' || mime === 'text/markdown') answer = result(decodeText(bytes, false), mime);
      else {
        if (!validImage(bytes, mime)) throw new Error('Fotografia je poškodená alebo nemá deklarovaný formát.');
        answer = result(await photoText(file, mime, operation), mime);
      }
      operation.check();
      return answer;
    } catch (error) {
      operation.check();
      throw error;
    } finally { if (active === operation) active = null; }
  }

  async function recognizePhoto(source, onProgress) {
    var operation = begin(onProgress);
    try {
      await operation.stopped;
      operation.check();
      var file = await readPhotoSource(source, operation);
      operation.check();
      sizeCheck(file);
      var mime = kindOf(file);
      if (!/^image\/(?:png|jpeg|webp)$/.test(mime)) throw new Error('Vyber fotografiu JPG, PNG alebo WebP.');
      var bytes = new Uint8Array(await file.arrayBuffer());
      operation.check();
      if (bytes.length !== file.size || !validImage(bytes, mime)) throw new Error('Fotografia je poškodená alebo nemá deklarovaný formát.');
      var text = await photoText(file, mime, operation);
      operation.check();
      if (text.length > MAX_TEXT) throw new Error('Prepis presahuje 200 000 znakov. Rozdeľ fotografiu na menšie časti.');
      return text;
    } catch (error) {
      operation.check();
      throw error;
    } finally { if (active === operation) active = null; }
  }

  root.MOKnowledgeExtract = { extract: extract, recognizePhoto: recognizePhoto, cancel: cancel, getPdfLibrary: pdfLibrary };
})(typeof window !== 'undefined' ? window : globalThis);
