'use strict';
// Safe pre-release audit: only the isolated schema rehearsal is permitted to
// upgrade a v2 DB. The public simulator and admin must remain v2 untouched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  PREFIX, SOURCE_STORES, STAGE_STORE, GENERATION,
  uniqueSandboxName, assertSandboxName, stageUpgradeOnly, runRehearsal
} = require('../../exhibit/backup_schema_rehearsal.js');
const builder = fs.readFileSync('exhibit/build.py', 'utf8');
const game = fs.readFileSync('js/pages_preview.js', 'utf8');
const admin = fs.readFileSync('exhibit/admin.js', 'utf8');
const rehearsal = fs.readFileSync('exhibit/backup_schema_rehearsal.js', 'utf8');
const page = fs.readFileSync('exhibit/backup_rehearsal.html', 'utf8');
const workflow = fs.readFileSync('.github/workflows/verify-public-preview.yml','utf8');

assert.equal(PREFIX,'gitai-backup-rehearsal-');
assert.deepEqual(SOURCE_STORES,['images','meta','theater_frames']);
assert.equal(STAGE_STORE,'backup_v2_stage');
assert.equal(GENERATION,'gen00042');
const cryptoApi = {getRandomValues(data) { data.fill(0x5a); return data; }};
const name = uniqueSandboxName(cryptoApi);
assert.equal(name, PREFIX + '5a'.repeat(16));
assert.equal(assertSandboxName(name),name);
for(const unsafe of [
  'gitai-exhibit-2026-konchu2026_cryptic',
  'gitai-exhibit-backup-rehearsal',
  '../'+name,
  name+'-other',
  PREFIX+'g'.repeat(32),
  PREFIX+'a'.repeat(20)
]) assert.throws(()=>assertSandboxName(unsafe),/隔離試験以外/);
assert.throws(()=>uniqueSandboxName({}),/安全な乱数/);

function fixture({old=2,dbVersion=3,missing=false,existing=false}={}) {
  const stores = new Set(missing?SOURCE_STORES.slice(0,-1):SOURCE_STORES);
  if(existing)stores.add(STAGE_STORE);
  const created=[];
  const db={
    version:dbVersion,
    objectStoreNames:{contains:name=>stores.has(name)},
    createObjectStore(name){
      if(stores.has(name))throw Error('ConstraintError');
      stores.add(name);created.push(name);
      return {};
    },
    deleteObjectStore(){throw Error('DO NOT DELETE AN EXISTING STORE');}
  };
  return {old,db,created,stores};
}
let v=fixture();
stageUpgradeOnly(v.db,v.old);
assert.deepEqual(v.created,[STAGE_STORE]);
assert.ok(v.stores.has('images'));
assert.ok(v.stores.has('meta'));
assert.ok(v.stores.has('theater_frames'));
assert.throws(()=>stageUpgradeOnly(v.db,v.old),/想定外/);
for(const opts of [
  {old:0},{old:1},{old:3},{dbVersion:2},{dbVersion:4},
  {missing:true},{existing:true}
]){
  v=fixture(opts);
  assert.throws(()=>stageUpgradeOnly(v.db,v.old),/想定外/);
  assert.deepEqual(v.created,[]);
}

assert.match(game,/const DB_VERSION = 2/);
assert.match(admin,/indexedDB\.open\(name, 2\)/);
assert.match(rehearsal,/idb\.open\(name, version\)/);
assert.match(rehearsal,/idb\.deleteDatabase\(name\)/);
assert.match(rehearsal,/assertSandboxName\(name\)/);
assert.match(rehearsal,/tx\.abort\(\)/);
assert.match(rehearsal,/error\?\.name !== 'AbortError'/);
assert.doesNotMatch(rehearsal,/if \(\/予期せず完了\//);

assert.match(rehearsal,/new Blob/);
assert.match(rehearsal,/makeCheckpoint\(db, snapshotId\)/);
assert.match(rehearsal,/writePartsFromRecords/);
assert.match(rehearsal,/verifyPartIntegrity/);
assert.match(rehearsal,/VersionError/);
assert.match(rehearsal,/blocked = true/);
assert.match(rehearsal,/await deleteSandbox\(indexedDb, name\)/);
assert.match(page,/<button type="button" id="run"/);
assert.match(page,/addEventListener\('click'/);
assert.doesNotMatch(page,/onload\s*=/i);
assert.match(page,/<meta name="robots" content="noindex,nofollow">/);
for(const f of ['backup_rehearsal.html','backup_schema_rehearsal.js',
  'backup_checkpoint_v2.js','backup_v2.js']){
  assert.match(builder,new RegExp(f.replaceAll('.','\\.')));
}
assert.doesNotMatch(fs.readFileSync('exhibit/index.html','utf8'),
  /backup_schema_rehearsal/);
assert.doesNotMatch(fs.readFileSync('exhibit/modes.html','utf8'),
  /backup_schema_rehearsal/);
assert.doesNotMatch(admin,/backup_schema_rehearsal/);
assert.match(workflow,/verify-exhibit-stage-upgrade-preflight/);
assert.equal(typeof runRehearsal,'function');

(async()=>{
  // No IndexedDB calls if a dependency is absent, no accidental opener.
  await assert.rejects(runRehearsal({indexedDb:{
    open(){throw Error('A live DB was opened unexpectedly')}
  },cryptoApi,checkpointApi:null,backupApi:null}),/必須モジュール/);
  console.log('RE2-EXH-02 rehearsal: sandbox-only IDB naming, strictly additive v3 upgrade, zero production auto-loading, explicit-click offline page and legacy v2 guards OK.');
})().catch(e=>{console.error(e);process.exitCode=1;});
