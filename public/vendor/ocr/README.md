# Local photo transcription

Magnum Opus loads this OCR engine only when the user requests a photo transcription. Recognition runs in a browser worker with the bundled Slovak and English language data. The helper uses same-origin URLs for the script, worker, WebAssembly core, and language data; it does not upload a photo to an AI service. Saving the resulting note and its photo uses the game's normal private account storage.

Tesseract is intended here for clear **printed text**. Handwriting is not supported reliably. The user reviews and corrects the recognized text before saving it. Subject suggestions elsewhere in the game use category names and user-defined keywords, not a remote language model.

## Bundled upstream versions

- `tesseract.js` **6.0.1**: `tesseract.min.js`, `worker.min.js`, and bundled license notices. Source: <https://github.com/naptha/tesseract.js> and the official npm package <https://registry.npmjs.org/tesseract.js/-/tesseract.js-6.0.1.tgz>.
- `tesseract.js-core` **6.0.0**: files in `core/`, including the core's license. Source: <https://github.com/naptha/tesseract.js-core> and <https://registry.npmjs.org/tesseract.js-core/-/tesseract.js-core-6.0.0.tgz>.
- `@tesseract.js-data/slk` **1.0.0** and `@tesseract.js-data/eng` **1.0.0**: the `4.0.0_best_int` language data from their official npm packages. The `.traineddata.gz` sources are stored here uncompressed as `lang/slk.traineddata` and `lang/eng.traineddata`. Source: <https://github.com/naptha/tessdata>.

Tesseract.js and its core are distributed under Apache License 2.0. Retain `LICENSE-tesseract.md`, `core/LICENSE`, and the `*.LICENSE.txt` notices with these files. The language npm package manifests declare MIT for their packaging; upstream Tesseract trained language data is distributed under Apache License 2.0, see <https://github.com/tesseract-ocr/tessdata_best/blob/main/LICENSE>.

The local helper specifies `gzip: false` for the uncompressed language data and `workerBlobURL: false` for a same-origin worker URL. No API key is needed. The first transcription initializes the engine and language files, so it may take longer than later transcriptions.

`window.MOPhotoOCR.recognize(dataURL, onProgress)` returns the recognized text. Its optional progress callback receives a Slovak display string, such as `Rozpoznávam text… 50 %`. `resize(file, max = 1800)` prepares an opaque JPEG whose longest side is at most `max` pixels and whose data URL fits the study note photo limit. `cancel()` terminates an active worker; canceled recognition rejects with an `AbortError`.
