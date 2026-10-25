import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// One-time, local-only transfer. A saved local section is never overwritten.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://127.0.0.1:4175';
const section = process.argv[2];
if (!['desk', 'study'].includes(section) || !process.argv[3]) throw Error('Use: node scripts/import-initial-section.mjs desk|study data/imports/file.json');
const importRoot = fs.realpathSync(path.join(root, 'data', 'imports'));
const filename = fs.realpathSync(path.resolve(root, process.argv[3]));
const relative = path.relative(importRoot, filename);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.extname(filename).toLowerCase() !== '.json') throw Error('Import must be a JSON file inside data/imports');
if (fs.statSync(filename).size > 12 * 1024 * 1024) throw Error('Backup exceeds 12 MiB');
const backup = JSON.parse(fs.readFileSync(filename, 'utf8'));
if (section === 'desk' && backup.format !== 'magnum-opus-desk') throw Error('Unexpected desk backup format');
if (section === 'study' && backup.format && backup.format !== 'magnum-opus-personal-study') throw Error('Unexpected study backup format');
const model = (await import(section === 'desk' ? '../server/desk-model.mjs' : '../server/study-model.mjs')).default;
const state = model.validateState(backup.state || backup);
const recordFile = path.join(importRoot, 'local-sections-migration.json');
const records = fs.existsSync(recordFile) ? JSON.parse(fs.readFileSync(recordFile, 'utf8')) : [];
if (!Array.isArray(records)) throw Error('Unexpected migration log format');
const headers = { Origin: origin, 'X-MO-Request': '1', 'Content-Type': 'application/json' };
const opened = await fetch(origin + '/api/auth/local', { method: 'POST', headers, body: '{}' });
const session = await opened.json();
if (!opened.ok || !session.localMode || !session.account) throw Error('Local personal profile could not be opened');
const cookie = opened.headers.get('set-cookie')?.split(';')[0];
if (!cookie) throw Error('Missing local session');
const privateHeaders = { ...headers, Cookie: cookie, 'X-MO-CSRF': session.csrf };
const endpoint = origin + '/api/' + section;
const before = await fetch(endpoint, { headers: privateHeaders });
if (!before.ok) throw Error('Could not inspect local section');
const previous = await before.json();
if (previous.revision !== 0) throw Error('Local section is already saved. Nothing was replaced.');
const saved = await fetch(endpoint, { method: 'PUT', headers: privateHeaders, body: JSON.stringify({ state, expectedRevision: 0 }) });
if (!saved.ok) throw Error('Section transfer failed: ' + saved.status);
const verified = await fetch(endpoint, { headers: privateHeaders });
const after = await verified.json();
if (!verified.ok || JSON.stringify(after.state) !== JSON.stringify(state)) throw Error('Imported section did not match its backup');
const counts = section === 'desk'
  ? { items: state.items.length, strokes: state.strokes.length }
  : { categories: state.categories.length, notes: state.notes.length };
const record = { section, file: relative, sourceExportedAt: backup.exportedAt || null, importedAt: new Date().toISOString(), revision: after.revision, counts };
fs.writeFileSync(recordFile, JSON.stringify([...records, record], null, 2));
console.log(JSON.stringify({ imported: true, section, ...counts, verified: true }));
