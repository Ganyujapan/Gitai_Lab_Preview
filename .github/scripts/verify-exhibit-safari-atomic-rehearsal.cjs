'use strict';
// Assert the NEW real-browser atomic-restore rehearsal cannot silently touch
// a live exhibition DB, load without a click, or mislabel a deliberate abort
// as an actual iPad quota/crash test. CI does not execute Safari.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const paths=[
  'exhibit/backup_atomic_rehearsal.js',
  'exhibit/backup_restore_atomic_v2.js',
  'exhibit/backup_restore_preflight_v2.js',
  'exhibit/backup_schema_rehearsal.js'
];
const source=Object.fromEntries(paths.map(p=>[p,fs.readFileSync(p,'utf8')]));
for(const path of paths) new vm.Script(source[path],{filename:path});
const test=source['exhibit/backup_atomic_rehearsal.js'];
const atomic=source['exhibit/backup_restore_atomic_v2.js'];
const page=fs.readFileSync('exhibit/backup_rehearsal.html','utf8');
const build=fs.readFileSync('exhibit/build.py','utf8');
const docScript=page.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(docScript,'explicit-button handler missing');
new vm.Script(docScript[1],{filename:'exhibit/backup_rehearsal.html:inline'});
const {runRehearsal,genome,checkGenome,LOCI}=
  require('../../exhibit/backup_atomic_rehearsal.js');
const restore=require('../../exhibit/backup_restore_atomic_v2.js');
assert.equal(LOCI.length,12);
for(let i=1;i<=60;i++)checkGenome(genome(i),i);
assert.throws(()=>checkGenome({...genome(5),baseHue:3},5),/DNA/);
assert.equal(typeof restore.commitStagedRestore,'function');
assert.match(atomic,/simulateAbortAfterRecords=null/);
assert.match(atomic,/Isolated simulated transaction abort/);
assert.match(atomic,/requireSandbox\(db,prepared.stageId\)/);
assert.match(test,/schemaApi\.uniqueSandboxName\(cryptoApi\)/);
assert.match(test,/schemaApi\.stageUpgradeOnly\(target,oldVersion\)/);
assert.match(test,/simulateAbortAfterRecords:15/);
assert.match(test,/if\(!injected\)/);
assert.match(test,/assertOld\(await readState\(db\)\)/);
assert.match(test,/status!=='db-committed'/);
assert.match(test,/lifeRestored:false/);
assert.match(test,/await removeSandbox\(indexedDb,name,onPhase\)/);
assert.match(test,/new Blob\(\['legacy-png'\]\)/);
assert.match(test,/canvas\.toBlob/);
assert.match(test,/createImageBitmap\(blob\)/);
assert.match(test,/img\.onload/);
assert.match(test,/db\.transaction\(stores,'readonly'\)/);
assert.match(test,/indexedDb\.deleteDatabase\(name\)/);
assert.doesNotMatch(test,/gitai-exhibit-2026-/);
assert.doesNotMatch(test,/localStorage\./);
assert.doesNotMatch(test,/\.clear\(/);
assert.match(page,/<button type="button" id="runRestore">/);
assert.match(page,/restoreButton\.addEventListener\('click'/);
assert.match(page,/GitaiAtomicRestoreRehearsal\.runRehearsal/);
assert.match(page,/実際の容量不足、強制終了、本番DBの動作を証明するテストではありません/);
assert.doesNotMatch(page,/<body[^>]*onload=/i);
for(const path of paths)assert.match(build,new RegExp(path.split('/').at(-1).replaceAll('.','\\.')));
assert.match(build,/backup_rehearsal\.html/);
for(const p of ['exhibit/index.html','exhibit/modes.html',
  'exhibit/admin.js','exhibit/landing.js','exhibit/game.js']){
  const contents=fs.readFileSync(p,'utf8');
  assert.doesNotMatch(contents,/backup_atomic_rehearsal/);
  assert.doesNotMatch(contents,/backup_restore_atomic_v2/);
}
(async()=>{
  let opened=0;
  await assert.rejects(runRehearsal({
    indexedDb:{open(){opened++;throw Error('PRODUCTION DATABASE OPEN VIOLATION')}},
    cryptoApi:null
  }),/モジュール|必須/);
  assert.equal(opened,0);
  console.log('RE2-EXH-02: Safari opt-in sandbox restore rehearsal is syntax-valid, 12-locus DNA test data valid, real-IDB abort injection gated, explicit-only, production-DB untouched. Real iPad test remains pending.');
})().catch(e=>{console.error(e);process.exitCode=1;});
