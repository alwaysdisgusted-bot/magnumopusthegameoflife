(function (root) {
  'use strict';

  var scriptPromise = null;
  var activeWorker = null;
  var generation = 0;
  var MAX_PHOTO_LENGTH = 2800000;

  function aborted() {
    var error = new Error('Prepis bol zrušený.');
    error.name = 'AbortError';
    return error;
  }

  function asset(path) {
    return new URL('/vendor/ocr/' + path, root.location.href).href;
  }

  function loadLibrary() {
    if (root.Tesseract && typeof root.Tesseract.createWorker === 'function') return Promise.resolve(root.Tesseract);
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise(function (resolve, reject) {
      var script = root.document.createElement('script');
      var settled = false;
      var timer = root.setTimeout(function () { finish(new Error('Prepis sa nepodarilo načítať. Skús to znova.')); }, 45000);
      function finish(error) {
        if (settled) return;
        settled = true;
        root.clearTimeout(timer);
        script.onload = script.onerror = null;
        if (error) {
          script.remove();
          scriptPromise = null;
          reject(error);
        } else resolve(root.Tesseract);
      }
      script.src = asset('tesseract.min.js');
      script.async = true;
      script.onload = function () {
        finish(root.Tesseract && typeof root.Tesseract.createWorker === 'function' ? null : new Error('Prepis nie je dostupný. Obnov stránku a skús to znova.'));
      };
      script.onerror = function () { finish(new Error('Prepis sa nepodarilo načítať. Skontroluj pripojenie a skús to znova.')); };
      root.document.head.appendChild(script);
    });
    return scriptPromise;
  }

  function terminate(worker) {
    if (!worker) return Promise.resolve();
    try { return Promise.resolve(worker.terminate()).catch(function () {}); }
    catch (_) { return Promise.resolve(); }
  }

  function cancel() {
    generation += 1;
    var previous = activeWorker;
    activeWorker = null;
    return terminate(previous);
  }

  async function recognize(dataURL, onProgress) {
    if (typeof dataURL !== 'string' || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(dataURL) || dataURL.length > 16000000) {
      throw new Error('Vyber fotografiu vo formáte JPG, PNG alebo WebP.');
    }
    if (typeof root.Worker !== 'function') throw new Error('Tento prehliadač nepodporuje prepis fotografií. Text môžeš zapísať ručne.');
    var previousTermination = cancel();
    var ownGeneration = generation;
    var worker = null;
    function check() { if (ownGeneration !== generation) throw aborted(); }
    function progress(message) {
      if (ownGeneration !== generation || typeof onProgress !== 'function') return;
      var labels = {
        'loading': 'Pripravujem prepis…',
        'loading tesseract core': 'Načítavam prepisovací nástroj…',
        'initializing tesseract': 'Pripravujem prepisovací nástroj…',
        'loading language traineddata': 'Načítavam slovenčinu a angličtinu…',
        'initializing api': 'Pripravujem rozpoznávanie…',
        'recognizing text': 'Rozpoznávam text…'
      };
      var label = labels[message && message.status] || 'Pripravujem prepis…';
      if (message && Number.isFinite(message.progress)) label += ' ' + Math.round(Math.max(0, Math.min(1, message.progress)) * 100) + ' %';
      try { onProgress(label); } catch (_) {}
    }
    try {
      await previousTermination;
      check();
      var library = await loadLibrary();
      check();
      progress({ status: 'loading', progress: 0 });
      worker = await library.createWorker(['slk', 'eng'], 1, {
        workerPath: asset('worker.min.js'),
        corePath: asset('core'),
        langPath: asset('lang'),
        gzip: false,
        workerBlobURL: false,
        logger: progress
      });
      check();
      activeWorker = worker;
      var result = await worker.recognize(dataURL);
      check();
      var value = result && result.data && result.data.text;
      return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
    } catch (error) {
      if (ownGeneration !== generation || (error && error.name === 'AbortError')) throw aborted();
      throw new Error('Fotografiu sa nepodarilo prepísať. Skús ostrejšiu fotografiu alebo zapíš text ručne.');
    } finally {
      if (activeWorker === worker) activeWorker = null;
      await terminate(worker);
    }
  }

  function readImage(file) {
    var url = root.URL.createObjectURL(file);
    return new Promise(function (resolve, reject) {
      var image = new root.Image();
      image.onload = function () { root.URL.revokeObjectURL(url); resolve(image); };
      image.onerror = function () {
        root.URL.revokeObjectURL(url);
        reject(new Error('Fotografiu sa nepodarilo otvoriť. Použi JPG, PNG alebo WebP.'));
      };
      image.src = url;
    });
  }

  async function resize(file, max) {
    if (!file || !/^image\/(?:jpeg|png|webp)$/.test(file.type || '')) throw new Error('Vyber fotografiu JPG, PNG alebo WebP.');
    if (!Number.isFinite(file.size) || file.size > 25 * 1024 * 1024) throw new Error('Fotografia môže mať najviac 25 MB.');
    var limit = max === undefined ? 1800 : Math.round(Number(max));
    if (!Number.isFinite(limit) || limit < 160 || limit > 3200) throw new Error('Neplatná veľkosť fotografie.');
    var image = await readImage(file);
    var width = image.naturalWidth;
    var height = image.naturalHeight;
    if (!width || !height || width * height > 80000000) throw new Error('Fotografia je príliš veľká alebo poškodená.');
    var scale = Math.min(1, limit / Math.max(width, height));
    var canvas = root.document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    function draw() {
      var context = canvas.getContext('2d');
      if (!context) throw new Error('Prehliadač nedokázal pripraviť fotografiu.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    }
    draw();
    for (var quality = 0.9; quality >= 0.49; quality -= 0.1) {
      var photo = canvas.toDataURL('image/jpeg', quality);
      if (photo.length <= MAX_PHOTO_LENGTH) return photo;
    }
    for (var attempt = 0; attempt < 4; attempt += 1) {
      canvas.width = Math.max(1, Math.round(canvas.width * 0.75));
      canvas.height = Math.max(1, Math.round(canvas.height * 0.75));
      draw();
      var smaller = canvas.toDataURL('image/jpeg', 0.75);
      if (smaller.length <= MAX_PHOTO_LENGTH) return smaller;
    }
    throw new Error('Fotografiu sa nepodarilo zmenšiť. Vyber menší obrázok.');
  }

  root.MOPhotoOCR = { recognize: recognize, resize: resize, cancel: cancel };
})(typeof window !== 'undefined' ? window : globalThis);
