import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { unzipSync } from 'fflate';

// Validate an isolated restored copy. Never opens the live database.
const root = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
if (!process.argv[2]) throw Error('Specify a local ZIP backup');
const backup = fs.realpathSync(path.resolve(root, process.argv[2]));
if (!backup.startsWith(path.join(root, 'backups') + path.sep)) throw Error('Backup must be inside backups');
const contents = unzipSync(fs.readFileSync(backup));
if (!contents['BACKUP.txt'] || !contents['public/assets/profile-picture.png']) throw Error('Incomplete backup');
const qa = path.join(root, 'data', 'qa');
fs.mkdirSync(qa, { recursive: true });
const restored = path.join(qa, 'restore-check-' + randomUUID());
fs.mkdirSync(restored);
let databaseCount = 0;
let personalCounts = null;
try {
  for (const [name, bytes] of Object.entries(contents)) {
    if (name.includes('\\') || name.split('/').includes('..')) throw Error('Unsafe archive entry');
    const target = path.resolve(restored, name);
    if (!target.startsWith(restored + path.sep)) throw Error('Archive entry escaped restore folder');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes, { flag: 'wx' });
  }
  for (const name of Object.keys(contents).filter(n => n.startsWith('.wrangler/state/') && n.endsWith('.sqlite'))) {
    const db = new DatabaseSync(path.join(restored, name), { readOnly: true });
    try {
      const integrity = db.prepare('PRAGMA integrity_check').all();
      if (!integrity.length || integrity.some(row => Object.values(row)[0] !== 'ok')) throw Error('Restored database failed integrity check');
      databaseCount++;
      if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='wizard_accounts'").get()) {
        const account = db.prepare('SELECT id FROM wizard_accounts WHERE display_name=?').get('AlwaysDisgusted');
        if (!account) throw Error('Expected profile missing from restored backup');
        personalCounts = {};
        for (const table of ['workspace_pages', 'workspace_tasks', 'calendar_notes', 'library_categories', 'library_photos', 'alchemy_desks', 'personal_study']) {
          const column = table.startsWith('workspace_') ? 'owner_account_id' : 'account_id';
          personalCounts[table] = db.prepare('SELECT count(*) AS count FROM ' + table + ' WHERE ' + column + '=?').get(account.id).count;
        }
      }
    } finally { db.close(); }
  }
  if (!personalCounts) throw Error('No personal database found in backup');
  const result = { verified: true, backup: path.basename(backup), entries: Object.keys(contents).length, databases: databaseCount, profile: 'AlwaysDisgusted', counts: personalCounts, scope: 'isolated ZIP extraction and SQLite integrity; not another-PC app launch' };
  fs.writeFileSync(path.join(qa, 'backup-verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  const resolved = fs.realpathSync(restored);
  if (!resolved.startsWith(fs.realpathSync(qa) + path.sep) || fs.lstatSync(restored).isSymbolicLink()) throw Error('Unsafe cleanup target');
  fs.rmSync(resolved, { recursive: true });
}
