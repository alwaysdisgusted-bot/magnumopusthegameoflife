import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

// Owner-authorized local maintenance: record verified work and deliver a private
// system letter. This does not grant a player permission to message strangers.
const root = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const origin = 'http://127.0.0.1:4175';
const sourceRoot = fs.realpathSync(path.join(root, 'data', 'reports'));
if (!process.argv[2]) throw Error('Specify a report JSON inside data/reports');
const filename = fs.realpathSync(path.resolve(root, process.argv[2]));
if (!filename.startsWith(sourceRoot + path.sep) || fs.statSync(filename).size > 64 * 1024) throw Error('Invalid report path or size');
const manifest = JSON.parse(fs.readFileSync(path.join(root, '.openai/hosting.json'), 'utf8'));
if (manifest.project_id) throw Error('Local reports must not run against a hosted project');
const report = JSON.parse(fs.readFileSync(filename, 'utf8'));
const key = value => String(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const validText = (value, limit) => typeof value === 'string' && value.trim() && value.length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
if (report.format !== 'magnum-opus-local-task-report' || !/^[a-z0-9_-]{8,80}$/.test(report.key) || !validText(report.subject, 160) || /[\r\n]/.test(report.subject)) throw Error('Invalid report identity');
if (!Array.isArray(report.completedWork) || report.completedWork.length > 20 || !Array.isArray(report.unresolved) || report.unresolved.length > 50) throw Error('Invalid report entries');
for (const item of report.completedWork) if (!/^[a-z0-9_-]{1,80}$/.test(item.key) || !validText(item.title, 160) || !validText(item.evidence, 18000)) throw Error('Invalid completed work');
for (const item of report.unresolved) if (!validText(item.title, 160) || !validText(item.reason, 1500) || !validText(item.nextStep, 800)) throw Error('Invalid unresolved work');
if (new Set(report.completedWork.map(x => x.key)).size !== report.completedWork.length || new Set(report.unresolved.map(x => key(x.title))).size !== report.unresolved.length) throw Error('Repeated report entries');
const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-MO-Request': '1' };
const opened = await fetch(origin + '/api/auth/local', { method: 'POST', headers, body: '{}' });
const session = await opened.json();
if (!opened.ok || !session.localMode || session.account?.name !== 'AlwaysDisgusted') throw Error('Expected personal local AlwaysDisgusted profile');
const cookie = opened.headers.get('set-cookie')?.split(';')[0];
if (!cookie) throw Error('Missing personal session');
async function api(route, method = 'GET', body) {
  const result = await fetch(origin + route, { method, headers: { ...headers, Cookie: cookie, 'X-MO-CSRF': session.csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!result.ok) throw Error('Local request failed: ' + result.status);
  return result.json();
}
const initial = (await api('/api/workspace/tasks')).tasks;
const open = initial.filter(t => t.status !== 'done');
if (open.length !== report.unresolved.length || open.some(t => !report.unresolved.some(r => key(r.title) === key(t.title)))) throw Error('The open task list changed; review it before sending');
const completedIds = [];
for (const item of report.completedWork) {
  const marker = '[MO-DONE:' + item.key + ']';
  const matches = initial.filter(t => t.description.includes(marker));
  if (matches.length > 1) throw Error('Repeated completed-work marker');
  if (matches.length) {
    if (matches[0].status !== 'done') throw Error('A recorded completion was reopened; review it manually');
    completedIds.push(matches[0].id);
    continue;
  }
  const result = await api('/api/workspace/tasks', 'POST', { title: item.title, description: item.evidence + '\n\n' + marker, status: 'done', roomId: null, assigneeId: null });
  completedIds.push(result.task.id);
}
const current = (await api('/api/workspace/tasks')).tasks;
if (current.filter(t => t.status !== 'done').length !== open.length || completedIds.some(id => !current.some(t => t.id === id && t.status === 'done'))) throw Error('Task status verification failed');
const text = [
  'Kontrola osobnej Pracovne profilu AlwaysDisgusted.',
  'Hotové práce z posledných úprav sú zapísané v stĺpci Hotovo. Počet otvorených rozšírení podľa pôvodného zadania: ' + open.length + '.',
  'Väčšina je technicky realizovateľná a potrebuje ďalšiu implementáciu. Pri externých prepojeniach sú potrebné aj konkrétne zdroje, účty alebo pravidlá. Nižšie je dôvod, prečo ich zatiaľ nemožno označiť ako hotové.',
  ...open.map((task, index) => {
    const entry = report.unresolved.find(r => key(r.title) === key(task.title));
    return (index + 1) + '. ' + task.title + '\nStav a chýbajúce časti: ' + entry.reason + '\nĎalší krok: ' + entry.nextStep;
  }),
  'Správa je uložená len v lokálnej hre. Neodoslala sa e-mailom ani ostatným hráčom. Otvorené úlohy neboli zverejnené ani označené ako dokončené.'
].join('\n\n');
if (text.length > 10000) throw Error('Report exceeds mailbox message limit');

const d1Root = fs.realpathSync(path.join(root, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject'));
const candidates = [];
for (const name of fs.readdirSync(d1Root).filter(n => n.endsWith('.sqlite'))) {
  const file = path.join(d1Root, name);
  if (fs.lstatSync(file).isSymbolicLink()) throw Error('Unexpected database link');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='wizard_accounts'").get() && db.prepare('SELECT id FROM wizard_accounts WHERE id=? AND owner_id=? AND display_name=?').get(session.account.id, 'magnum-local-personal-v1', 'AlwaysDisgusted')) candidates.push(file);
  } finally { db.close(); }
}
if (candidates.length !== 1) throw Error('Could not identify the personal local database');
const senderId = 'magnum-local-assistant-reports';
const senderOwner = 'magnum-local-reports-v1';
const senderName = 'Magnum Opus · Asistent';
const messageId = 'local-report-' + createHash('sha256').update(report.key).digest('hex').slice(0, 32);
const db = new DatabaseSync(candidates[0]);
let inserted = false;
try {
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
  if (!db.prepare('SELECT id FROM wizard_accounts WHERE id=? AND owner_id=? AND display_name=?').get(session.account.id, 'magnum-local-personal-v1', 'AlwaysDisgusted')) throw Error('The report recipient changed');
  // A non-playable, hidden system sender: no session, password login or public profile.
  db.prepare('INSERT INTO wizard_accounts(id,owner_id,normalized_name,display_name,password_hash,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').run(senderId, senderOwner, 'magnum-opus-local-system-reports', senderName, '!disabled-local-system-sender!', Date.now());
  const sender = db.prepare('SELECT owner_id,display_name,password_hash FROM wizard_accounts WHERE id=?').get(senderId);
  if (sender.owner_id !== senderOwner || sender.display_name !== senderName || sender.password_hash !== '!disabled-local-system-sender!') throw Error('Unexpected system sender');
  const previous = db.prepare('SELECT sender_id,recipient_id,subject,text FROM social_mail WHERE id=?').get(messageId);
  if (previous) {
    if (previous.sender_id !== senderId || previous.recipient_id !== session.account.id || previous.subject !== report.subject || previous.text !== text) throw Error('This report key was already used for different content');
  } else {
    const count = db.prepare('SELECT count(*) AS n FROM social_mail WHERE sender_id=? OR recipient_id=?').get(session.account.id, session.account.id).n;
    if (count >= 500) throw Error('Mailbox is full; no message was deleted');
    db.prepare('INSERT INTO social_mail(id,sender_id,recipient_id,subject,text,created_at,read_at) VALUES(?,?,?,?,?,?,NULL)').run(messageId, senderId, session.account.id, report.subject, text, Date.now());
    inserted = true;
  }
  db.exec('COMMIT');
} catch (error) {
  try { db.exec('ROLLBACK'); } catch { /* No live transaction. */ }
  throw error;
} finally { db.close(); }
const delivered = (await api('/api/social/mail/' + messageId)).message;
if (delivered.recipientId !== session.account.id || delivered.senderName !== senderName || delivered.text !== text || delivered.subject !== report.subject) throw Error('Mailbox delivery verification failed');
const receipt = { delivered: true, profile: session.account.name, messageId, inserted, completedWork: completedIds.length, done: current.filter(t => t.status === 'done').length, open: open.length, taskIds: completedIds, at: new Date().toISOString() };
fs.writeFileSync(path.join(sourceRoot, report.key + '-receipt.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ delivered: true, profile: receipt.profile, done: receipt.done, open: receipt.open, newCompletionRecords: completedIds.length, duplicateMessage: !inserted }));
