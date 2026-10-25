/* eslint-disable @typescript-eslint/no-require-imports -- Node test fixtures use CommonJS. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const moduleReady = import('../scripts/prepare-source-handoff.mjs');
function fixture(t) {const root=fs.mkdtempSync(path.join(os.tmpdir(),'mo-source-handoff-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function write(root,file,text='safe source') {const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text);return target;}
test('source selection excludes local user data, profile photo, and shortcuts', async()=>{
  const {selectSourceFiles}=await moduleReady;
  const selected=selectSourceFiles(['public/app.js','data/save.json','public/assets/profile-picture.png','.env.local','Magnum Opus.lnk','backups/a.zip']);
  assert.deepEqual(selected.included,['public/app.js']);assert.equal(selected.excluded.length,5);
});
test('handoff copies reviewed sources with hashes and preserves private originals', async t=>{
  const {prepareSourceHandoff}=await moduleReady;const root=fixture(t);
  write(root,'public/app.js','const answer = 42;');const photo=write(root,'public/assets/profile-picture.png','private original');write(root,'data/save.json','private save');
  const result=prepareSourceHandoff({root,paths:['public/app.js','public/assets/profile-picture.png','data/save.json']});
  const manifest=JSON.parse(fs.readFileSync(path.join(result.directory,'manifest.json'),'utf8'));
  assert.equal(result.networkWrite,false);assert.equal(result.files,1);assert.equal(fs.readFileSync(photo,'utf8'),'private original');
  assert.equal(fs.existsSync(path.join(result.source,'data/save.json')),false);
  assert.equal(manifest.files[0].sha256,crypto.createHash('sha256').update('const answer = 42;').digest('hex'));
});
test('handoff rejects credential-like source contents without exposing values', async t=>{
  const {prepareSourceHandoff}=await moduleReady;const root=fixture(t);
  write(root,'public/app.js',['sk','proj', 'a'.repeat(48)].join('-'));
  assert.throws(()=>prepareSourceHandoff({root,paths:['public/app.js']}),error=>error.message.includes('credential')&&!error.message.includes('a'.repeat(48)));
});
test('handoff refuses missing sources and symlinked private output', async t=>{
  const {prepareSourceHandoff}=await moduleReady;const root=fixture(t);
  assert.throws(()=>prepareSourceHandoff({root,paths:['public/missing.js']}),/inspection blocked/);
  write(root,'public/app.js');const outside=fixture(t);fs.mkdirSync(path.join(root,'data'));fs.symlinkSync(outside,path.join(root,'data/workflow'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>prepareSourceHandoff({root,paths:['public/app.js']}),/ordinary local directories/);
});
