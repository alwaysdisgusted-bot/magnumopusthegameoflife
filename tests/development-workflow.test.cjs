/* eslint-disable @typescript-eslint/no-require-imports -- Node test fixtures use CommonJS. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const workflow = import('../scripts/development-workflow.mjs');
const configuration = () => ({ version: 1, maxTestExecutions: 100, modules: { knowledge: { name: 'Knowledge', paths: ['public/knowledge-system', 'tests/knowledge-system-store.test.cjs'], tests: [{ file: 'tests/knowledge-system-store.test.cjs', cases: 6, pattern: '^store' }] } } });

test('workflow rejects private paths, traversal and unrestricted test targets', async () => {
  const { sourcePath, validateConfig } = await workflow;
  for (const value of ['../secret', 'data/game.json', '.wrangler/state', 'public/assets/profile-picture.png', '.env.local', 'tests/*.test.cjs', 'C:/data', 'tests\\a.test.cjs']) assert.throws(() => sourcePath(value));
  assert.equal(sourcePath('public/knowledge-system'), 'public/knowledge-system');
  const config = configuration();
  config.modules.knowledge.tests[0].file = 'scripts/run-all.mjs';
  assert.throws(() => validateConfig(config), /exact tests/);
});

test('workflow plans only explicit files with patterns and optional fixed checks', async () => {
  const { planChecks } = await workflow;
  const plan = planChecks(configuration(), 'knowledge', { types: true, build: true });
  assert.equal(plan.executions, 8);
  assert.deepEqual(plan.checks[0].args, ['--test', '--test-reporter=tap', '--test-name-pattern', '^store', 'tests/knowledge-system-store.test.cjs']);
  assert.deepEqual(plan.checks.map(check => check.kind), ['test', 'types', 'build']);
  assert.throws(() => planChecks(configuration(), 'all'), /Unknown module/);
});

test('workflow reserves failed attempts and rejects the cumulative budget overflow', async () => {
  const { reserveExecutions, planChecks } = await workflow;
  const first = reserveExecutions({ executionsUsed: 94 }, 6, 100);
  assert.equal(first.executionsUsed, 100);
  assert.throws(() => reserveExecutions(first, 1, 100), /budget exhausted/);
  const config = configuration();
  config.maxTestExecutions = 6;
  assert.throws(() => planChecks(config, 'knowledge', { types: true }), /exceed/);
  assert.throws(() => reserveExecutions({ executionsUsed: -1 }, 1), /Invalid/);
});

test('workflow CLI cannot accept arbitrary commands or unsafe task identifiers', async () => {
  const { parseArguments } = await workflow;
  assert.deepEqual(parseArguments(['prepare', '--title', 'Local change', '--module', 'knowledge', '--accept', 'Opens the source', '--accept', 'Preserves data']).options.accept, ['Opens the source', 'Preserves data']);
  for (const args of [['check', '--module', 'knowledge', '--exec', 'npm test'], ['finish', '--task', '../save'], ['prepare', '--title', 'x', '--module', 'knowledge'], ['status', '--build'], ['check', '--module', 'knowledge', '--module', 'all']]) assert.throws(() => parseArguments(args));
});

test('workflow status parser handles renames and excludes private names', async () => {
  const { parseGitStatus } = await workflow;
  const changes = parseGitStatus(' M public/map.js\0R  public/new.js\0public/old.js\0?? tests/new.test.cjs\0 M data/private.json\0');
  assert.deepEqual(changes.map(change => change.path), ['public/map.js', 'public/new.js', 'tests/new.test.cjs']);
  assert.equal(changes[1].status, 'R ');
});

test('workflow completion requires current passing evidence and retains human review', async () => {
  const { reviewState } = await workflow;
  const task = { acceptanceCriteria: ['Works in the browser'], checks: [{ kind: 'test', file: 'tests/a.test.cjs', status: 'passed', sourceSha256: 'before' }] };
  assert.equal(reviewState(task, 'after'), 'needs_work');
  assert.equal(reviewState(task, 'before'), 'ready_for_review');
  task.checks.push({ kind: 'test', file: 'tests/a.test.cjs', status: 'failed', sourceSha256: 'before' });
  assert.equal(reviewState(task, 'before'), 'needs_work');
  assert.deepEqual(task.acceptanceCriteria, ['Works in the browser']);
});

test('workflow locates npm in bundled, configured, Windows and Linux Node layouts', async () => {
  const { npmCliCandidates } = await workflow;
  const project = path.resolve('fixture-project');
  const executable = path.resolve('fixture-runtime/bin/node');
  const configured = path.resolve('fixture-configured/npm-cli.js');
  const candidates = npmCliCandidates(project, executable, configured);
  assert.equal(candidates[0], path.join(project, '.runtime/npm/bin/npm-cli.js'));
  assert.equal(candidates[1], configured);
  assert.ok(candidates.includes(path.join(path.dirname(executable), 'node_modules/npm/bin/npm-cli.js')));
  assert.ok(candidates.includes(path.resolve(path.dirname(executable), '../lib/node_modules/npm/bin/npm-cli.js')));
  assert.ok(!npmCliCandidates(project, executable, 'npm.cmd').includes('npm.cmd'));
});
