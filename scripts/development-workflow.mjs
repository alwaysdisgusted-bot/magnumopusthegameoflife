import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const PRIVATE = /^(?:data|backups|node_modules|\.runtime|\.wrangler|\.git|\.codex|\.agents|\.sites-runtime|dist|outputs|work)(?:\/|$)|(?:^|\/)\.env[^/]*$|(?:^|\/)\.dev\.vars[^/]*$|^public\/assets\/profile-picture\.png$/i;
const now = () => new Date().toISOString();

export function sourcePath(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.includes('\\') || /[\0-\x1f\x7f*?\[\]{}:]/.test(value) || path.posix.isAbsolute(value) || value.split('/').some(part => !part || part === '.' || part === '..') || PRIVATE.test(value)) {
    throw new Error('Expected a relative source path without private directories, traversal or globs.');
  }
  return value;
}

export function validateConfig(config) {
  if (!config || config.version !== 1 || !Number.isInteger(config.maxTestExecutions) || config.maxTestExecutions < 1 || config.maxTestExecutions > 100 || !config.modules || Array.isArray(config.modules) || typeof config.modules !== 'object' || !Object.keys(config.modules).length) {
    throw new Error('.workflow/modules.json requires version 1, maxTestExecutions (1–100), and a nonempty modules map.');
  }
  for (const [id, module] of Object.entries(config.modules)) {
    if (!ID.test(id) || !module || typeof module.name !== 'string' || !module.name.trim() || !Array.isArray(module.paths) || !module.paths.length || !Array.isArray(module.tests)) throw new Error(`Invalid workflow module: ${id}.`);
    module.paths.forEach(sourcePath);
    let total = 0;
    for (const entry of module.tests) {
      sourcePath(entry.file);
      if (!/^tests\/[a-zA-Z0-9][a-zA-Z0-9_.-]*\.test\.cjs$/.test(entry.file) || !Number.isInteger(entry.cases) || entry.cases < 1 || entry.cases > 100) throw new Error(`Module ${id} needs exact tests/*.test.cjs files and positive cases counts.`);
      if (entry.pattern !== undefined) {
        if (typeof entry.pattern !== 'string' || !entry.pattern || entry.pattern.length > 300 || /[\0\r\n]/.test(entry.pattern)) throw new Error(`Invalid test name pattern in ${id}.`);
        try { new RegExp(entry.pattern); } catch { throw new Error(`Invalid test name pattern in ${id}.`); }
      }
      total += entry.cases;
    }
    if (total > config.maxTestExecutions) throw new Error(`Module ${id} exceeds the configured test budget.`);
  }
  return config;
}

function loadConfig(root) {
  const filename = path.join(root, '.workflow/modules.json');
  if (!fs.existsSync(filename)) throw new Error('Missing .workflow/modules.json. Add a module with exact source paths, targeted test files and cases counts.');
  return validateConfig(JSON.parse(fs.readFileSync(filename, 'utf8')));
}

export function planChecks(config, moduleId, { types = false, build = false } = {}) {
  validateConfig(config);
  const selectedModule = Object.hasOwn(config.modules, moduleId) && config.modules[moduleId];
  if (!selectedModule) throw new Error(`Unknown module: ${moduleId}. Choose an ID from .workflow/modules.json.`);
  const checks = selectedModule.tests.map(entry => ({ kind: 'test', file: entry.file, cases: entry.cases, args: ['--test', '--test-reporter=tap', ...(entry.pattern ? ['--test-name-pattern', entry.pattern] : []), entry.file] }));
  if (types) checks.push({ kind: 'types', cases: 1 });
  if (build) checks.push({ kind: 'build', cases: 1 });
  const executions = checks.reduce((sum, check) => sum + check.cases, 0);
  if (!checks.length) throw new Error(`Module ${moduleId} has no targeted checks. Choose --types or --build explicitly.`);
  if (executions > config.maxTestExecutions) throw new Error(`Planned ${executions} executions exceed the ${config.maxTestExecutions} limit.`);
  return { module: selectedModule, checks, executions };
}

export function reserveExecutions(task, count, max = 100) {
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(max) || max < 1 || max > 100 || !Number.isInteger(task.executionsUsed) || task.executionsUsed < 0) throw new Error('Invalid execution ledger.');
  if (task.executionsUsed + count > max) throw new Error(`Test budget exhausted: ${task.executionsUsed} used, ${count} planned, limit ${max}.`);
  return { ...task, executionsUsed: task.executionsUsed + count };
}

function run(executable, args, root, options = {}) {
  return spawnSync(executable, args, { cwd: root, encoding: 'utf8', windowsHide: true, shell: false, timeout: 600_000, maxBuffer: 16 * 1024 * 1024, ...options });
}

function findGit(root) {
  const candidates = [process.env.MAGNUM_GIT_EXE, process.env.MAGNUM_GIT_PATH, 'git', process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Git/cmd/git.exe'), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs/Git/cmd/git.exe'), process.env.USERPROFILE && path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/cmd/git.exe')].filter(Boolean);
  return candidates.find(candidate => run(candidate, ['--version'], root).status === 0) ?? null;
}

function gitResult(git, args, root) {
  const result = run(git, ['-c', 'core.fsmonitor=false', ...args], root, { env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  if (result.status !== 0) throw new Error('Local Git inspection failed. Verify this checkout and MAGNUM_GIT_EXE.');
  return result.stdout;
}

export function parseGitStatus(output) {
  const parts = output.split('\0');
  const changes = [];
  for (let index = 0; index < parts.length; index += 1) {
    const record = parts[index];
    if (!record) continue;
    const status = record.slice(0, 2);
    const filename = record.slice(3).replaceAll('\\', '/');
    if (/R|C/.test(status)) index += 1;
    try { changes.push({ status, path: sourcePath(filename) }); } catch { /* Private or unusual paths are counted separately, never printed. */ }
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

function gitState(root, git = findGit(root)) {
  if (!git) return { available: false, reason: 'Git executable unavailable; set MAGNUM_GIT_EXE.' };
  if (run(git, ['rev-parse', '--is-inside-work-tree'], root).status !== 0) return { available: true, repository: false };
  const headResult = run(git, ['rev-parse', '--verify', 'HEAD'], root);
  const branchResult = run(git, ['symbolic-ref', '--quiet', '--short', 'HEAD'], root);
  const changes = parseGitStatus(gitResult(git, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], root));
  return { available: true, repository: true, head: headResult.status === 0 ? headResult.stdout.trim() : null, branch: branchResult.status === 0 ? branchResult.stdout.trim() : '(detached)', remoteCount: gitResult(git, ['remote'], root).split(/\r?\n/).filter(Boolean).length, changes };
}

function snapshot(root, git, module) {
  const state = gitState(root, git);
  if (!state.repository) throw new Error('A local Git checkout is required to prepare or review a task.');
  const hash = createHash('sha256').update(JSON.stringify({ head: state.head, changes: state.changes, module }));
  const diffArgs = ['diff', '--no-ext-diff', '--no-textconv', '--binary', ...(state.head ? ['HEAD'] : []), '--', ...module.paths];
  hash.update(gitResult(git, diffArgs, root));
  if (!state.head) hash.update(gitResult(git, ['diff', '--no-ext-diff', '--no-textconv', '--cached', '--binary', '--', ...module.paths], root));
  const untracked = gitResult(git, ['ls-files', '-z', '--others', '--exclude-standard', '--', ...module.paths], root).split('\0').filter(Boolean).sort();
  for (const filename of untracked) {
    sourcePath(filename);
    const absolute = path.join(root, filename);
    if (fs.lstatSync(absolute).isSymbolicLink()) throw new Error('Symlink source files cannot be included in workflow fingerprints.');
    hash.update(filename).update(fs.readFileSync(absolute));
  }
  return { head: state.head, changes: state.changes, sha256: hash.digest('hex') };
}

function safeDirectory(root, segments, create = false) {
  let current = path.resolve(root);
  for (const segment of segments) {
    current = path.join(current, segment);
    if (create && !fs.existsSync(current)) fs.mkdirSync(current, { mode: 0o700 });
    if (!fs.existsSync(current) || fs.lstatSync(current).isSymbolicLink() || !fs.statSync(current).isDirectory()) throw new Error('Workflow storage must use ordinary local directories.');
  }
  return current;
}

function workflowDirectory(root, git) {
  if (!git || run(git, ['check-ignore', '--quiet', 'data/workflow/workflow-private-check.json'], root).status !== 0) throw new Error('data/workflow must be ignored by Git before private task records can be written.');
  return safeDirectory(root, ['data', 'workflow'], true);
}

function taskDirectory(root, id) {
  if (!UUID.test(id ?? '')) throw new Error('Expected a task UUID returned by prepare/check.');
  return safeDirectory(root, ['data', 'workflow', id]);
}

function saveTask(directory, task) {
  const temporary = path.join(directory, 'task.json.tmp');
  fs.writeFileSync(temporary, `${JSON.stringify(task, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, path.join(directory, 'task.json'));
}

function loadTask(directory, id) {
  const filename = path.join(directory, 'task.json');
  if (fs.lstatSync(filename).isSymbolicLink()) throw new Error('Workflow records cannot be symlinks.');
  const task = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (task.version !== 1 || task.id !== id || !ID.test(task.module) || !Array.isArray(task.acceptanceCriteria) || !Array.isArray(task.checks)) throw new Error('Invalid task record.');
  return task;
}

function handoff(task, module, current = task.source) {
  const lines = [`# ${task.title}`, '', `Task: ${task.id}`, `Module: ${task.module} — ${module.name}`, `State: ${task.state}`, '', '## Acceptance criteria', '', ...task.acceptanceCriteria.map(item => `- [ ] ${item} (human verification pending)`), '', '## Source snapshot', '', `Prepared HEAD: ${task.source.head ?? '(unborn)'}`, `Prepared fingerprint: ${task.source.sha256}`, `Current fingerprint: ${current.sha256}`, `Pre-existing changed paths: ${task.source.changes.length}`, '', '## Module paths', '', ...module.paths.map(filename => `- ${filename}`), '', '## Checks', '', `Reserved executions: ${task.executionsUsed}/${task.maxTestExecutions}`, ...task.checks.map(check => `- ${check.kind}${check.file ? ` ${check.file}` : ''}: ${check.status}; fingerprint ${check.sourceSha256}; private log ${check.log}`), '', '## Suggested next steps', '', `1. Implement and review only this module; preserve pre-existing changes.`, `2. Run: & ".\\.runtime\\node\\node.exe" scripts/development-workflow.mjs check --module ${task.module} --task ${task.id}`, `3. Run: & ".\\.runtime\\node\\node.exe" scripts/development-workflow.mjs finish --task ${task.id}`, '4. Review the diff and verify every acceptance criterion before marking the game task complete.', '', 'These commands do not code, commit, push, open a PR, or mark a game task complete.', 'GitHub publication requires a separately authorized private source-only repository and verified exclusions.', ''];
  return lines.join('\n');
}

function writeHandoff(directory, task, module, current) {
  const filename = path.join(directory, 'HANDOFF.md');
  if (fs.existsSync(filename) && fs.lstatSync(filename).isSymbolicLink()) throw new Error('Handoff files cannot be symlinks.');
  fs.writeFileSync(filename, handoff(task, module, current), { mode: 0o600 });
}

function createTask(root, git, config, moduleId, title, acceptanceCriteria) {
  const selectedModule = Object.hasOwn(config.modules, moduleId) && config.modules[moduleId];
  if (!selectedModule || !ID.test(moduleId)) throw new Error(`Unknown module: ${moduleId}.`);
  const id = randomUUID();
  const base = workflowDirectory(root, git);
  const directory = safeDirectory(base, [id], true);
  const task = { version: 1, id, title, module: moduleId, acceptanceCriteria, state: 'prepared', createdAt: now(), maxTestExecutions: config.maxTestExecutions, executionsUsed: 0, source: snapshot(root, git, selectedModule), checks: [] };
  saveTask(directory, task);
  writeHandoff(directory, task, selectedModule);
  return { task, directory };
}

export function npmCliCandidates(root, executable, npmExecPath) {
  const directory = path.dirname(executable);
  return [...new Set([
    path.join(root, '.runtime/npm/bin/npm-cli.js'),
    ...(npmExecPath && path.basename(npmExecPath).toLowerCase() === 'npm-cli.js' ? [npmExecPath] : []),
    path.join(directory, 'node_modules/npm/bin/npm-cli.js'),
    path.resolve(directory, '../lib/node_modules/npm/bin/npm-cli.js'),
  ])];
}

function checkArguments(root, check) {
  if (check.kind === 'test') {
    const filename = path.join(root, check.file);
    let component = root;
    for (const segment of check.file.split('/')) {
      component = path.join(component, segment);
      if (fs.existsSync(component) && fs.lstatSync(component).isSymbolicLink()) throw new Error('Targeted tests cannot traverse symlinks.');
    }
    if (!fs.existsSync(filename) || fs.lstatSync(filename).isSymbolicLink()) throw new Error(`Missing ordinary targeted test file: ${check.file}.`);
    return check.args;
  }
  if (check.kind === 'types') {
    const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
    if (!fs.existsSync(tsc)) throw new Error('Local TypeScript compiler is missing.');
    return [tsc, '--noEmit'];
  }
  const npm = npmCliCandidates(root, process.execPath, process.env.npm_execpath).find(filename => fs.existsSync(filename));
  if (!npm) throw new Error('npm CLI is missing. Install npm alongside Node or use the bundled .runtime/npm.');
  return [npm, 'run', 'build'];
}

function checkTask(root, git, config, moduleId, options) {
  const plan = planChecks(config, moduleId, options);
  const commands = plan.checks.map(check => checkArguments(root, check));
  const created = options.task ? null : createTask(root, git, config, moduleId, `Targeted checks: ${moduleId}`, ['Review the requested behavior manually.']);
  const id = options.task ?? created.task.id;
  const directory = created?.directory ?? taskDirectory(root, id);
  const lock = path.join(directory, 'check.lock');
  const descriptor = fs.openSync(lock, 'wx', 0o600);
  try {
    let task = loadTask(directory, id);
    if (task.module !== moduleId) throw new Error('The selected module differs from the prepared task.');
    const limit = Math.min(config.maxTestExecutions, task.maxTestExecutions);
    const current = snapshot(root, git, plan.module);
    // Reserve the whole attempt durably before any process starts, including failures/interruption.
    task = reserveExecutions(task, plan.executions, limit);
    const start = task.checks.length;
    task.checks.push(...plan.checks.map((check, index) => ({ kind: check.kind, ...(check.file ? { file: check.file } : {}), reservedExecutions: check.cases, status: 'interrupted_or_pending', startedAt: now(), sourceSha256: current.sha256, log: `check-${start + index + 1}.log` })));
    task.state = 'needs_work';
    saveTask(directory, task);
    const results = [];
    for (let index = 0; index < plan.checks.length; index += 1) {
      const check = task.checks[start + index];
      const result = run(process.execPath, commands[index], root, { env: { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}` } });
      const passed = !result.error && result.status === 0;
      fs.writeFileSync(path.join(directory, check.log), `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? `\n${result.error.message}` : ''}`, { mode: 0o600, flag: 'wx' });
      check.status = passed ? 'passed' : 'failed';
      check.finishedAt = now();
      check.exitCode = result.status;
      results.push({ kind: check.kind, ...(check.file ? { file: check.file } : {}), status: check.status });
      saveTask(directory, task);
    }
    writeHandoff(directory, task, plan.module, current);
    return { ok: results.every(result => result.status === 'passed'), task: id, state: task.state, executionsUsed: task.executionsUsed, limit, results };
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
  }
}

export function reviewState(task, currentSha256) {
  const matching = task.checks.filter(check => check.sourceSha256 === currentSha256);
  const latest = new Map(matching.map(check => [`${check.kind}:${check.file ?? ''}`, check]));
  return latest.size > 0 && [...latest.values()].every(check => check.status === 'passed') ? 'ready_for_review' : 'needs_work';
}

export function parseArguments(argv) {
  const [command, ...rest] = argv;
  const accepted = { status: [], prepare: ['title', 'module', 'accept'], check: ['module', 'task', 'types', 'build'], finish: ['task'] }[command];
  if (!accepted) throw new Error('Use status, prepare --title TEXT --module ID --accept CRITERION, check --module ID [--task UUID] [--types] [--build], or finish --task UUID.');
  const options = { accept: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const name = rest[index].startsWith('--') ? rest[index].slice(2) : '';
    if (!accepted.includes(name)) throw new Error(`Unknown option for ${command}.`);
    if (name === 'types' || name === 'build') {
      if (options[name]) throw new Error(`Duplicate --${name}.`);
      options[name] = true;
    } else {
      const value = rest[++index];
      if (!value || value.startsWith('--') || /[\0-\x1f\x7f]/.test(value)) throw new Error(`--${name} needs a single-line value.`);
      if (name === 'accept') options.accept.push(value.trim());
      else if (options[name] !== undefined) throw new Error(`Duplicate --${name}.`);
      else options[name] = value.trim();
    }
  }
  if (['prepare', 'check'].includes(command) && !ID.test(options.module ?? '')) throw new Error('--module requires an ID from .workflow/modules.json.');
  if (command === 'prepare' && (!options.title || options.title.length > 300 || !options.accept.length || options.accept.length > 30 || options.accept.some(value => !value || value.length > 1000))) throw new Error('prepare requires a title (1–300 characters) and 1–30 --accept criteria (1–1000 characters each).');
  if ((command === 'finish' || options.task) && !UUID.test(options.task ?? '')) throw new Error('--task requires a task UUID.');
  return { command, options };
}

export function main(argv = process.argv.slice(2), root = ROOT) {
  const { command, options } = parseArguments(argv);
  const git = findGit(root);
  if (command === 'status') {
    const state = gitState(root, git);
    if (!state.repository) return { ok: true, git: state, networkActions: false };
    return { ok: true, git: { available: true, repository: true, branch: state.branch, head: state.head, remoteCount: state.remoteCount, changedSourcePaths: state.changes.length, stagedSourcePaths: state.changes.filter(change => change.status[0] !== ' ' && change.status !== '??').length, untrackedSourcePaths: state.changes.filter(change => change.status === '??').length }, networkActions: false };
  }
  const config = loadConfig(root);
  if (!git) throw new Error('Git executable unavailable; set MAGNUM_GIT_EXE to your installed Git executable.');
  if (command === 'prepare') {
    const { task } = createTask(root, git, config, options.module, options.title, options.accept);
    return { ok: true, task: task.id, state: task.state, module: task.module, handoff: `data/workflow/${task.id}/HANDOFF.md` };
  }
  if (command === 'check') return checkTask(root, git, config, options.module, options);
  const directory = taskDirectory(root, options.task);
  const lock = path.join(directory, 'check.lock');
  if (fs.existsSync(lock)) throw new Error('This task has a running or interrupted check; review its private ledger before retrying.');
  const descriptor = fs.openSync(lock, 'wx', 0o600);
  try {
    const task = loadTask(directory, options.task);
    const selectedModule = Object.hasOwn(config.modules, task.module) && config.modules[task.module];
    if (!selectedModule) throw new Error('The task module no longer exists in .workflow/modules.json.');
    const current = snapshot(root, git, selectedModule);
    task.state = reviewState(task, current.sha256);
    task.reviewedAt = now();
    task.reviewSnapshot = current;
    saveTask(directory, task);
    writeHandoff(directory, task, selectedModule, current);
    return { ok: true, task: task.id, state: task.state, acceptance: 'human_verification_pending', handoff: `data/workflow/${task.id}/HANDOFF.md` };
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = main();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
    process.exitCode = 1;
  }
}
