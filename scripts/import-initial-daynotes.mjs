import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://127.0.0.1:4175';
const importRoot = fs.realpathSync(path.join(root, 'data/imports'));
if (!process.argv[2]) throw Error('Specify a notes export in data/imports');
const filename = fs.realpathSync(path.resolve(root, process.argv[2]));
const relative = path.relative(importRoot, filename);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || fs.statSync(filename).size > 12 * 1024 * 1024) throw Error('Invalid import path or size');
const backup = JSON.parse(fs.readFileSync(filename, 'utf8'));
if (backup.format !== 'magnum-opus-private-daynotes-transfer' || backup.sourceProfile !== 'AlwaysDisgusted' || !Array.isArray(backup.notes) || backup.notes.length > 2000) throw Error('Invalid notes export');
const headers = { Origin: origin, 'X-MO-Request': '1', 'Content-Type': 'application/json' };
const opened = await fetch(origin + '/api/auth/local', { method: 'POST', headers, body: '{}' });
const session = await opened.json();
if (!opened.ok || !session.localMode || session.account?.name !== 'AlwaysDisgusted') throw Error('Expected local AlwaysDisgusted profile');
const cookie = opened.headers.get('set-cookie')?.split(';')[0];
if (!cookie) throw Error('Missing local session');
async function api(route, body) {
  const response = await fetch(origin + route, { method: body ? 'POST' : 'GET', headers: { ...headers, Cookie: cookie, 'X-MO-CSRF': session.csrf }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw Error('Local notes request failed: ' + response.status);
  return response.json();
}
const before = await api('/api/calendar/notes?all=1');
if (before.notes.length) throw Error('Local notes are not empty. Nothing was replaced.');
const mappings = [];
for (const note of backup.notes) {
  const body = { title: note.title, date: note.date, text: note.text, pins: note.pins, visibility: note.visibility, featured: note.featured };
  const result = await api('/api/calendar/notes', body);
  mappings.push({ sourceId: note.sourceId, localId: result.note.id });
}
const after = await api('/api/calendar/notes?all=1');
for (const note of backup.notes) {
  const found = after.notes.find(n => n.id === mappings.find(m => m.sourceId === note.sourceId)?.localId);
  if (!found || ['title', 'date', 'text', 'visibility', 'featured'].some(key => found[key] !== note[key]) || JSON.stringify([...found.pins].sort()) !== JSON.stringify([...note.pins].sort())) throw Error('Notes verification failed');
}
fs.writeFileSync(path.join(importRoot, 'daynotes-migration.json'), JSON.stringify({ importedAt: new Date().toISOString(), sourceProfile: backup.sourceProfile, file: relative, mappings, count: backup.notes.length }, null, 2));
console.log(JSON.stringify({ imported: true, notes: backup.notes.length, verified: true, visibilityPreserved: true }));
