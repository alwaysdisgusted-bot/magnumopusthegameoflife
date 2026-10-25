/* eslint-disable @typescript-eslint/no-require-imports -- Node test fixtures use CommonJS. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const api = import('../scripts/check-source-boundaries.mjs');

function removeFixture(directory) {
  const parent = path.resolve(os.tmpdir());
  const target = path.resolve(directory);
  assert.equal(path.dirname(target), parent);
  assert.match(path.basename(target), /^magnum-source-(?:boundary|outside)-/);
  fs.rmSync(target, { recursive: true, force: true });
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magnum-source-boundary-'));
  t.after(() => removeFixture(root));
  const write = (name, content) => {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  return { root, write };
}

test('source boundaries accept source and binary assets without changing them', async (t) => {
  const { inspectSourcePaths } = await api;
  const { root, write } = fixture(t);
  write('src/app.js', 'export const local = true;');
  write('public/icon.png', Buffer.from([137, 80, 0, 78]));
  const result = inspectSourcePaths({ root, paths: ['src/app.js', 'public/icon.png', 'src/app.js'] });
  assert.deepEqual(result, { ok: true, selected: 2, scanned: 2, findings: [] });
  assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), 'export const local = true;');
});

test('source boundaries block private locations, personal photo, and unsafe relative paths before reading', async () => {
  const { sourcePathReason } = await api;
  const blocked = ['.wrangler/state/db', 'data/report.json', 'BACKUPS/save.zip', '.runtime/node.exe', 'node_modules/pkg/file', '.codex/state', '.agents/state', '.env.local', 'src/.dev.vars.test', 'public\\assets\\profile-picture.png', '../outside', 'C:\\private.txt', '/private.txt', 'src/../safe.js', 'src/file.js:stream', 'src/save.sqlite-wal', 'data./private.json', 'public/assets/profile-picture.png.'];
  for (const name of blocked) assert.ok(sourcePathReason(name), `expected to block ${name}`);
  assert.equal(sourcePathReason('src/app/api/route.ts'), null);
});

test('source boundaries detect plausible credentials while diagnostics contain no secret values', async (t) => {
  const { inspectSourcePaths } = await api;
  const { root, write } = fixture(t);
  const credential = ['sk', 'proj', 'A'.repeat(48)].join('-');
  write('src/unsafe.js', `const key = '${credential}';`);
  write('src/key.txt', ['-----BEGIN', 'PRIVATE KEY-----'].join(' '));
  write('tests/example.cjs', "const example = ['sk', 'proj', 'A'.repeat(48)].join('-');");
  const result = inspectSourcePaths({ root, paths: ['src/unsafe.js', 'src/key.txt', 'tests/example.cjs'] });
  assert.equal(result.ok, false);
  assert.equal(result.findings.length, 2);
  assert.equal(result.findings[0].reason, 'possible OpenAI credential');
  assert.equal(JSON.stringify(result).includes(credential), false);
});

test('source boundaries fail closed for missing files and links that escape the selected root', async (t) => {
  const { inspectSourcePaths } = await api;
  const { root } = fixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'magnum-source-outside-'));
  t.after(() => removeFixture(outside));
  fs.writeFileSync(path.join(outside, 'source.js'), 'sensitive outside file');
  fs.symlinkSync(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = inspectSourcePaths({ root, paths: ['missing.js', 'linked/source.js'] });
  assert.equal(result.ok, false);
  assert.deepEqual(result.findings.map((finding) => finding.reason), ['selected source file does not exist', 'source file resolves outside the repository']);
});

test('source manifests accept a JSON file list and reject malformed selections', async (t) => {
  const { readSourceManifest, inspectSourcePaths } = await api;
  const { root, write } = fixture(t);
  write('manifest.json', JSON.stringify({ files: ['src/app.js'] }));
  assert.deepEqual(readSourceManifest(path.join(root, 'manifest.json')), ['src/app.js']);
  write('manifest.json', JSON.stringify({ files: [42] }));
  assert.throws(() => readSourceManifest(path.join(root, 'manifest.json')), /array of relative file paths/);
  assert.throws(() => inspectSourcePaths({ root, paths: [] }), /No source files/);
});
