import { readFileSync, writeFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/desk-model.js', import.meta.url), 'utf8');
const marker = '})(typeof globalThis';
const start = source.indexOf("  'use strict';", source.indexOf(marker));
if (start < 0 || !source.endsWith('});\n')) throw new Error('Unexpected desk model wrapper.');
const target = 'const DeskModel = (function () {\n' + source.slice(start, -4) + '})();\nexport default DeskModel;\n';
const targetUrl = new URL('../server/desk-model.mjs', import.meta.url);
if (process.argv.includes('--check')) {
  if (readFileSync(targetUrl, 'utf8') !== target) throw new Error('Desk model is out of sync. Run node scripts/sync-desk-model.mjs.');
} else {
  writeFileSync(targetUrl, target);
}
