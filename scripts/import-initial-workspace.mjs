import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://127.0.0.1:4175';
const importRoot = fs.realpathSync(path.join(root, 'data/imports'));
if (!process.argv[2]) throw Error('Specify a workspace export in data/imports');
const filename = fs.realpathSync(path.resolve(root, process.argv[2]));
const relative = path.relative(importRoot, filename);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || fs.statSync(filename).size > 12 * 1024 * 1024) throw Error('Invalid local import path or size');
const raw = fs.readFileSync(filename);
const sourceHash = createHash('sha256').update(raw).digest('hex');
const backup = JSON.parse(raw.toString('utf8'));
if (backup.format !== 'magnum-opus-private-workspace-transfer' || !Array.isArray(backup.pages) || !Array.isArray(backup.tasks) || backup.pages.length > 200 || backup.tasks.length > 500) throw Error('Invalid workspace export');
const ids = new Set();
for (const item of [...backup.pages, ...backup.tasks]) {
  if (typeof item.sourceId !== 'string' || ids.has(item.sourceId) || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 160) throw Error('Invalid or repeated workspace entry');
  ids.add(item.sourceId);
}
for (const item of backup.pages) if (typeof item.body !== 'string' || item.body.length > 20000) throw Error('Invalid page body');
for (const item of backup.tasks) if (typeof item.description !== 'string' || item.description.length > 20000 || !['todo', 'doing', 'done'].includes(item.status)) throw Error('Invalid task');
const journalFile = path.join(importRoot, 'workspace-migration.json');
const journal = fs.existsSync(journalFile) ? JSON.parse(fs.readFileSync(journalFile, 'utf8')) : { sourceHash, entries: [], startedAt: new Date().toISOString() };
if (journal.sourceHash !== sourceHash || !Array.isArray(journal.entries)) throw Error('Another workspace migration already exists');
const headers = { Origin: origin, 'X-MO-Request': '1', 'Content-Type': 'application/json' };
const opened = await fetch(origin + '/api/auth/local', { method: 'POST', headers, body: '{}' });
const session = await opened.json();
if (!opened.ok || !session.localMode || session.account?.name !== 'AlwaysDisgusted') throw Error('Expected local AlwaysDisgusted profile');
const cookie = opened.headers.get('set-cookie')?.split(';')[0];
if (!cookie) throw Error('Missing local session');
async function api(route, body) {
  const response = await fetch(origin + route, { method: body ? 'POST' : 'GET', headers: { ...headers, Cookie: cookie, 'X-MO-CSRF': session.csrf }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw Error('Local workspace request failed: ' + response.status);
  return response.json();
}
const [beforePages, beforeTasks] = await Promise.all([api('/api/workspace/pages'), api('/api/workspace/tasks')]);
if (!journal.entries.length && (beforePages.pages.length || beforeTasks.tasks.length)) throw Error('Local workspace is not empty. Nothing was replaced.');
fs.writeFileSync(journalFile, JSON.stringify(journal, null, 2));
for (const [kind, items] of [['page', backup.pages], ['task', backup.tasks]]) {
  for (const item of items) {
    if (journal.entries.some(entry => entry.kind === kind && entry.sourceId === item.sourceId)) continue;
    const body = kind === 'page' ? { title: item.title, body: item.body, roomId: null } : { title: item.title, description: item.description, status: item.status, assigneeId: null, roomId: null };
    const result = await api('/api/workspace/' + (kind === 'page' ? 'pages' : 'tasks'), body);
    journal.entries.push({ kind, sourceId: item.sourceId, localId: result[kind].id });
    fs.writeFileSync(journalFile, JSON.stringify(journal, null, 2));
  }
}
const [afterPages, afterTasks] = await Promise.all([api('/api/workspace/pages'), api('/api/workspace/tasks')]);
for (const [kind, items, current] of [['page', backup.pages, afterPages.pages], ['task', backup.tasks, afterTasks.tasks]]) {
  for (const item of items) {
    const entry = journal.entries.find(entry => entry.kind === kind && entry.sourceId === item.sourceId);
    const found = current.find(row => row.id === entry?.localId);
    if (!found || found.roomId !== null || found.title !== item.title || (kind === 'page' ? found.body !== item.body : found.description !== item.description || found.status !== item.status)) throw Error('Workspace verification failed');
  }
}
journal.completedAt = new Date().toISOString();
journal.counts = { pages: backup.pages.length, tasks: backup.tasks.length, pending: backup.tasks.filter(t => t.status !== 'done').length };
fs.writeFileSync(journalFile, JSON.stringify(journal, null, 2));
console.log(JSON.stringify({ imported: true, ...journal.counts, verified: true }));
