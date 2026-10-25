'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../build/sites-vite-plugin.ts');
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(path.dirname(filename));
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);

test('Personal local middleware requires a loopback TCP peer and same-origin requests', () => {
  let handler;
  loaded.exports.sites({ mockAuth: false, personalLocal: true }).configureServer({
    config: { server: {}, logger: { info() {} } },
    middlewares: { use(fn) { handler = fn; } },
  });
  function run({ peer = '127.0.0.1', host = '127.0.0.1:4175', url = '/api/auth/session', origin, fetchSite } = {}) {
    const headers = { host, 'oai-authenticated-user-id': 'forged-person' };
    if (origin) headers.origin = origin;
    if (fetchSite) headers['sec-fetch-site'] = fetchSite;
    const request = { url, headers, rawHeaders: Object.entries(headers).flat(), socket: { remoteAddress: peer } };
    const response = { statusCode: 200, setHeader() {}, end() { this.ended = true; } };
    let continued = false;
    handler(request, response, () => { continued = true; });
    assert.equal(request.headers['oai-authenticated-user-id'], undefined);
    return { response, continued };
  }
  assert.equal(run().continued, true);
  for (const config of [{ peer: '192.168.1.4' }, { host: 'evil.example' }, { origin: 'https://evil.example' }, { fetchSite: 'cross-site' }, { url: 'http://evil.example/api/auth/session' }]) {
    const actual = run(config);
    assert.equal(actual.continued, false);
    assert.equal(actual.response.statusCode, 403);
  }
  assert.equal(run({ peer: '::1', host: 'localhost:4175' }).continued, true);
  assert.equal(run({ url: '/signin-with-chatgpt' }).response.statusCode, 404);
});
