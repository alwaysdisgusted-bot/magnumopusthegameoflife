import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const privateDirectories = new Set([
  '.git', '.wrangler', 'data', 'backups', '.runtime', 'node_modules', '.codex',
  '.agents', '.sites-runtime', 'outputs', 'work', 'dist', '.next', '.vinext', 'coverage',
]);
const maximumScanBytes = 32 * 1024 * 1024;
const secretPatterns = [
  ['private key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/u],
  ['OpenAI credential', /\bsk-proj-[A-Za-z0-9_-]{40,}\b/u],
  ['GitHub credential', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/u],
  ['AWS access credential', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u],
];

export function sourcePathReason(input) {
  if (typeof input !== 'string' || !input || /[\x00-\x1f\x7f]/u.test(input)) {
    return 'invalid source path';
  }
  const normalized = input.replaceAll('\\', '/');
  if (path.posix.isAbsolute(normalized) || /^[A-Za-z]:/u.test(normalized)) return 'absolute source path';
  const segments = normalized.split('/');
  if (segments.some((part) => !part || part === '.' || part === '..' || /[:]/u.test(part) || /[. ]$/u.test(part))) {
    return 'source path must stay inside the repository';
  }
  const lower = segments.map((part) => part.toLowerCase());
  if (lower.some((part) => privateDirectories.has(part))) return 'private data, generated output, or local tool directory';
  if (lower.some((part) => part.startsWith('.env') || part.startsWith('.dev.vars'))) return 'environment or credential file';
  if (lower.join('/') === 'public/assets/profile-picture.png') return 'personal profile photograph; keep it only in the local edition';
  if (/\.(?:sqlite3?|db)(?:-(?:wal|shm))?$/iu.test(normalized)) return 'database file';
  return null;
}

function isOutside(root, target) {
  const relative = path.relative(root, target);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

export function inspectSourcePaths({ root = projectRoot, paths }) {
  if (!Array.isArray(paths) || paths.length === 0) throw new Error('No source files were selected.');
  const resolvedRoot = realpathSync(root);
  const findings = [];
  let scanned = 0;
  for (const input of new Set(paths)) {
    const reason = sourcePathReason(input);
    if (reason) {
      findings.push({ path: typeof input === 'string' ? input : '[invalid path]', reason });
      continue;
    }
    const normalized = input.replaceAll('\\', '/');
    const fullPath = path.resolve(resolvedRoot, ...normalized.split('/'));
    try {
      if (isOutside(resolvedRoot, fullPath) || isOutside(resolvedRoot, realpathSync(fullPath))) {
        findings.push({ path: input, reason: 'source file resolves outside the repository' });
        continue;
      }
      // Refuse links in any ancestor too: a future source export must not follow them.
      let current = resolvedRoot;
      let linked = false;
      for (const segment of normalized.split('/')) {
        current = path.join(current, segment);
        if (lstatSync(current).isSymbolicLink()) { linked = true; break; }
      }
      const metadata = lstatSync(fullPath);
      if (linked || !metadata.isFile()) {
        findings.push({ path: input, reason: 'source entries must be ordinary files without symbolic links' });
        continue;
      }
      if (metadata.size > maximumScanBytes) {
        findings.push({ path: input, reason: 'file exceeds the 32 MiB source inspection limit' });
        continue;
      }
      const content = readFileSync(fullPath);
      scanned += 1;
      // Binary assets are checked by path; decode text only. Never print matching values.
      if (content.includes(0)) continue;
      const text = content.toString('utf8');
      for (const [kind, pattern] of secretPatterns) {
        if (pattern.test(text)) findings.push({ path: input, reason: `possible ${kind}` });
      }
    } catch (error) {
      findings.push({ path: input, reason: error.code === 'ENOENT' ? 'selected source file does not exist' : 'selected source file cannot be inspected' });
    }
  }
  return { ok: findings.length === 0, selected: new Set(paths).size, scanned, findings };
}

export function findGitBinary(explicit) {
  if (explicit) return explicit;
  const candidates = process.platform === 'win32' ? [
    process.env.MAGNUM_GIT_PATH,
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'native', 'git', 'cmd', 'git.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Git', 'cmd', 'git.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'cmd', 'git.exe'),
  ].filter(Boolean) : [];
  return candidates.find((candidate) => existsSync(candidate)) || 'git';
}

export function collectGitPaths(root = projectRoot, { gitBinary } = {}) {
  const result = spawnSync(findGitBinary(gitBinary), ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error('Cannot read the Git source list. Make Git available or provide --manifest / --paths.');
  return [...new Set(result.stdout.split('\0').filter(Boolean))];
}

export function readSourceManifest(filename) {
  const content = readFileSync(filename, 'utf8').replace(/^\uFEFF/u, '').trim();
  if (!content) throw new Error('The source manifest is empty.');
  const parsed = /^(?:\{|\[)/u.test(content) ? JSON.parse(content) : content.split(/\r?\n/u).filter(Boolean);
  const files = Array.isArray(parsed) ? parsed : parsed?.files;
  if (!Array.isArray(files) || files.some((file) => typeof file !== 'string')) throw new Error('The source manifest must contain an array of relative file paths.');
  return files;
}

export function runSourceBoundaryCli(args = process.argv.slice(2)) {
  try {
    let paths;
    if (args.length === 0) paths = collectGitPaths();
    else if (args[0] === '--manifest' && args.length === 2) paths = readSourceManifest(path.resolve(args[1]));
    else if (args[0] === '--paths' && args.length > 1) paths = args.slice(1);
    else if (args[0] === '--help' && args.length === 1) {
      console.log('Usage: node scripts/check-source-boundaries.mjs [--manifest <file> | --paths <relative-file> ...]');
      return 0;
    } else throw new Error('Use --manifest <file>, --paths <relative-file> ..., or no arguments for the Git source list.');
    const result = inspectSourcePaths({ paths });
    for (const finding of result.findings) console.error(`${JSON.stringify(finding.path)}: ${finding.reason}`);
    console.log(`Source boundary: ${result.ok ? 'PASS' : 'BLOCKED'} (${result.scanned}/${result.selected} files inspected).`);
    return result.ok ? 0 : 1;
  } catch (error) {
    // Filesystem errors can include the contents of an invalid JSON input. Keep diagnostics bounded.
    console.error(error instanceof SyntaxError ? 'Invalid source manifest JSON.' : error.code ? 'Cannot read the source manifest.' : error.message);
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = runSourceBoundaryCli();
}
