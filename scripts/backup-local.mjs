import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { zipSync } = require('fflate');
const root = fs.realpathSync(process.argv[2]);
const destination = path.resolve(process.argv[3]);
if (!destination.startsWith(path.join(root, 'backups') + path.sep) || fs.existsSync(destination)) throw Error('Invalid backup target');
const files = {};
function collect(relative) {
  const absolute = path.resolve(root, relative), entry = fs.lstatSync(absolute);
  if (entry.isSymbolicLink() || !absolute.startsWith(root + path.sep)) throw Error('Unexpected backup link');
  if (entry.isDirectory()) { for (const name of fs.readdirSync(absolute)) collect(path.join(relative, name)); }
  else if (entry.isFile() && !relative.startsWith(path.join('data', 'runtime'))) files[relative.split(path.sep).join('/')] = fs.readFileSync(absolute);
}
collect('.wrangler/state');
if (fs.existsSync(path.join(root, 'data/imports'))) collect('data/imports');
if (fs.existsSync(path.join(root, 'data/reports'))) collect('data/reports');
if (fs.existsSync(path.join(root, 'public/assets/profile-picture.png'))) collect('public/assets/profile-picture.png');
files['BACKUP.txt'] = Buffer.from('Magnum Opus local data backup. Restore only while the local game is stopped. Keep the existing .wrangler/state copy before restoring.\n');
fs.writeFileSync(destination, zipSync(files, { level: 1 }), { flag: 'wx' });
console.log(JSON.stringify({ files: Object.keys(files).length, bytes: fs.statSync(destination).size }));
