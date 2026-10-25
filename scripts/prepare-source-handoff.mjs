import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectGitPaths, inspectSourcePaths, sourcePathReason } from './check-source-boundaries.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MAX_BYTES = 256 * 1024 * 1024;
const MAX_FILES = 10000;

export function selectSourceFiles(paths) {
  const included = [], excluded = [];
  for (const filename of [...new Set(paths)].sort()) {
    const reason = sourcePathReason(filename) || (/\.(?:lnk|url)$/i.test(filename) ? 'local shortcut' : null);
    (reason ? excluded : included).push(reason ? { path: filename, reason } : filename);
  }
  if (!included.length || included.length > MAX_FILES) throw Error('Source selection is empty or exceeds 10,000 files.');
  return { included, excluded };
}

function directory(root, segments) {
  let current = fs.realpathSync(root);
  for (const segment of segments) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) fs.mkdirSync(current, { mode: 0o700 });
    if (fs.lstatSync(current).isSymbolicLink() || !fs.statSync(current).isDirectory()) throw Error('Handoff storage must contain ordinary local directories.');
  }
  return current;
}

export function prepareSourceHandoff({ root = ROOT, paths, gitBinary } = {}) {
  root = fs.realpathSync(root);
  const selected = selectSourceFiles(paths || collectGitPaths(root, { gitBinary }));
  const inspected = inspectSourcePaths({ root, paths: selected.included });
  if (!inspected.ok) throw Error('Source inspection blocked the handoff: '+inspected.findings.map(item => `${item.path}: ${item.reason}`).join('; '));
  const files = selected.included.map(filename => ({ path: filename, bytes: fs.statSync(path.join(root, filename)).size }));
  if (files.reduce((total, item) => total + item.bytes, 0) > MAX_BYTES) throw Error('Source handoff exceeds 256 MiB.');
  const id = 'source-handoff-'+randomUUID();
  const packet = directory(root, ['data', 'workflow', id]);
  const source = directory(packet, ['source']);
  try {
    for (const item of files) {
      // Inspect again immediately before reading. Never follow a changed link.
      if (!inspectSourcePaths({root, paths:[item.path]}).ok) throw Error('A selected source changed during preparation.');
      const content = fs.readFileSync(path.join(root, item.path));
      item.sha256 = createHash('sha256').update(content).digest('hex');
      const parent = directory(source, item.path.split('/').slice(0,-1));
      fs.writeFileSync(path.join(parent, path.basename(item.path)), content, { flag:'wx', mode:0o600 });
    }
    const finalCheck = inspectSourcePaths({root:source, paths:files.map(item => item.path)});
    if (!finalCheck.ok) throw Error('Prepared source failed final inspection.');
    // A default profile image is intentionally absent. The local original is untouched.
    const report = {version:1,id,createdAt:new Date().toISOString(),status:'prepared_for_review',networkWrite:false,source,files,excluded:selected.excluded};
    fs.writeFileSync(path.join(packet,'manifest.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
    fs.writeFileSync(path.join(packet,'source-files.json'),JSON.stringify(files.map(item=>item.path),null,2)+'\n',{flag:'wx',mode:0o600});
    fs.writeFileSync(path.join(packet,'HANDOFF.md'),[
      '# Zdrojový balík pre súkromný repozitár','',
      'Obsah source/ prešiel kontrolou ciest a základnou kontrolou prihlasovacích údajov. Balík sa nikam neodoslal.',
      'Neobsahuje herný save, fotografie z úložiska, pracovné záznamy, runtime ani osobnú profilovú fotografiu.',
      'Pri novej inštalácii pridaj vlastný public/assets/profile-picture.png alebo uprav portrét na vhodnú náhradu. Pôvodná lokálna fotka zostala na mieste.',
      'Tento balík je zdrojový snapshot, nie automatická zlúčená vetva. Pred prvým importom over cieľový súkromný repozitár a históriu existujúcich zmien.',
      'Zdrojový repozitár nie je úplná dátová záloha. Herný ZIP a export samostatnej mapy uchovávaj osobitne.',
      '',`Súbory: ${files.length}`,`Bajty: ${files.reduce((sum,item)=>sum+item.bytes,0)}`,'',
      'Pred uploadom over súkromie cieľového repozitára. Bez overeného cieľa nič neposielaj.',''
    ].join('\n'),{flag:'wx',mode:0o600});
    return {id,directory:packet,source,files:files.length,excluded:selected.excluded.length,status:report.status,networkWrite:false};
  } catch (error) {
    fs.writeFileSync(path.join(packet,'FAILED.txt'),'Neúplný balík; neodosielať. '+error.message+'\n',{mode:0o600});
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 2) throw Error('Run this helper without arguments. It prepares a local source-only copy; it never uploads.');
    console.log(JSON.stringify(prepareSourceHandoff()));
  } catch (error) { console.error(error.message); process.exitCode=1; }
}
