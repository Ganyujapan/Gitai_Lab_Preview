'use strict';
// No real IndexedDB access. Exercise the actual isolated migration preflight
// against a fake versionless-open API and assert ZERO write operations.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {inspectExistingDb,TARGET_VERSION,STAGE_STORE,summarizeCompatibility}=
  require('../../exhibit/backup_upgrade_preflight_v2.js');
const engine=fs.readFileSync('js/pages_preview.js','utf8');
const admin=fs.readFileSync('exhibit/admin.js','utf8');
const theater=fs.readFileSync('exhibit/theater_canvas_20261026.js','utf8');
const build=fs.readFileSync('exhibit/build.py','utf8');
assert.match(engine,/const DB_VERSION = 2/);
assert.match(admin,/indexedDB\.open\(name, 2\)/);
assert.doesNotMatch(build,/backup_upgrade_preflight_v2\.js/);
assert.match(build,/backup_checkpoint_v2\.js/);
assert.match(build,/backup_rehearsal\.html/);
// Presence in the offline distribution is allowed only as an opt-in diagnostic
// page; it must not auto-run from the normal game or exhibit admin screens.
const game=fs.readFileSync('exhibit/game.js','utf8');
const landing=fs.readFileSync('exhibit/landing.js','utf8');
assert.doesNotMatch(admin,/backup_schema_rehearsal/);
assert.doesNotMatch(game,/backup_schema_rehearsal/);
assert.doesNotMatch(landing,/backup_schema_rehearsal/);
assert.ok(TARGET_VERSION>2);
assert.equal(STAGE_STORE,'backup_v2_stage');

function fake({version=2,stage=false,missing=false,blocked=false,
  pointer='gen00035',badStores=false,abortRead=false}={}) {
  const operations=[], accesses=[], connections=[];
  const records={images:60,meta:62,theater_frames:3};
  const stores=badStores?['images','meta']:
    ['images','meta','theater_frames',...(stage?[STAGE_STORE]:[])];
  const db={
    version,
    close(){operations.push('close')},
    objectStoreNames:{contains(name){return stores.includes(name)}},
    transaction(names,mode) {
      operations.push('transaction '+mode);
      assert.deepEqual(Array.from(names),['images','meta','theater_frames']);
      assert.equal(mode,'readonly','no destructive IDB transaction');
      const tx={oncomplete:null,onabort:null,onerror:null,error:null,
        objectStore(store) {
          assert.ok(stores.includes(store));
          return {
            get(key) {
              assert.equal(store,'meta');
              assert.equal(key,'current_generation_id');
              const req={result:null,onsuccess:null};
              accesses.push('get:'+key);
              setImmediate(()=>{req.result=pointer;req.onsuccess?.();complete()});
              return req;
            },
            count() {
              const req={result:null,onsuccess:null};
              accesses.push('count:'+store);
              setImmediate(()=>{req.result=records[store];req.onsuccess?.();complete()});
              return req;
            }
          };
        }
      };
      let left=4;
      const complete=()=>{
        if(--left===0) {
          setImmediate(()=>{
            if(abortRead){tx.error=Error('AbortError');tx.onabort?.();}
            else tx.oncomplete?.();
          });
        }
      };
      return tx;
    }
  };
  const indexedDb={
    open(...args){
      assert.equal(args.length,1,'MUST omit version to prevent migration');
      accesses.push('open:'+args[0]);
      const req={result:null,error:null,onupgradeneeded:null,onerror:null,
        onblocked:null,onsuccess:null,transaction:null};
      connections.push(req);
      setImmediate(()=>{
        if(blocked)req.onblocked?.();
        if(missing){
          let aborted=false;
          req.transaction={abort(){
            aborted=true;operations.push('abort empty database creation');
            setImmediate(()=>{req.error=Error('AbortError');req.onerror?.()});
          }};
          req.onupgradeneeded?.({oldVersion:0});
          assert.equal(aborted,true);
        }else{
          req.result=db;
          setImmediate(()=>req.onsuccess?.());
        }
      });
      return req;
    }
  };
  return {indexedDb,operations,accesses,connections};
}
(async()=>{
 const env=fake();
 const s=await inspectExistingDb('exhibit-test',{indexedDb:env.indexedDb,
   runtimeVersions:{game:2,admin:2,theater:2},
   storageEstimate:async()=>({usage:1000,quota:2000})});
 assert.equal(s.status,'inspected');
 assert.equal(s.dbVersion,2);
 assert.equal(s.currentGeneration,'gen00035');
 assert.equal(s.storedEntries.images,60);
 assert.equal(s.storedEntries.meta,62);
 assert.equal(s.storedEntries.theater_frames,3);
 assert.equal(s.stageStorePresent,false);
 assert.equal(s.stagePrepared,false);
 assert.equal(s.gameCanOpenThisDatabase,true);
 assert.equal(s.migrationAllowed,false);
 assert.equal(s.storageEstimate.estimatedFreeBytes,1000);
 assert.equal(s.storageEstimate.sufficientForCheckpoint,'unverified');
 assert.deepEqual(env.operations,['transaction readonly','close']);
 assert.equal(env.accesses.length,5);
 assert.deepEqual(summarizeCompatibility(3,{game:2,admin:2,theater:2}).incompatibleReaders,
  ['game','admin','theater']);

 // Opening a migrated v3 DB while production code still opens v2 MUST
 // remain ineligible. A VersionError would otherwise break live games.
 const v3=fake({version:3,stage:true});
 const stale=await inspectExistingDb('exhibit-test',{indexedDb:v3.indexedDb,
   runtimeVersions:{game:2,admin:2,theater:2}});
 assert.equal(stale.stagePrepared,true);
 assert.equal(stale.gameCanOpenThisDatabase,false);
 assert.deepEqual(stale.incompatibleReaders,['game','admin','theater']);
 assert.equal(stale.migrationAllowed,false);
 const unknown=await inspectExistingDb('exhibit-test',{
   indexedDb:fake({version:3,stage:true}).indexedDb});
 assert.equal(unknown.compatible,false);
 assert.equal(unknown.migrationAllowed,false);
 const allV3=await inspectExistingDb('exhibit-test',{
   indexedDb:fake({version:3,stage:true}).indexedDb,
   runtimeVersions:{game:3,admin:3,theater:3}});
 assert.equal(allV3.compatible,true);
 assert.equal(allV3.stagePrepared,true);
 assert.equal(allV3.requiresExplicitMigrationApproval,true);
 assert.equal(allV3.migrationAllowed,false);

 const empty=fake({missing:true});
 const missing=await inspectExistingDb('not-created',{indexedDb:empty.indexedDb});
 assert.equal(missing.status,'missing');
 assert.equal(missing.migrationAllowed,false);
 assert.deepEqual(empty.operations,['abort empty database creation']);
 const invalid=fake({badStores:true});
 const invalidReport=await inspectExistingDb('bad',{indexedDb:invalid.indexedDb});
 assert.equal(invalidReport.status,'invalid-source-schema');
 assert.equal(invalidReport.migrationAllowed,false);
 assert.deepEqual(invalid.operations,['close']);
 const invalidGen=await inspectExistingDb('bad-pointer',{indexedDb:fake({pointer:'genX'}).indexedDb});
 assert.equal(invalidGen.status,'invalid-generation');

 const blocked=fake({blocked:true});
 let seenBlocked=0;
 const blockedReport=await inspectExistingDb('blocked-case',{indexedDb:blocked.indexedDb,
   onBlocked(){seenBlocked++}});
 assert.equal(blockedReport.status,'inspected');
 assert.equal(seenBlocked,1,'blocked request is observed without abandonment');
 assert.deepEqual(blocked.operations,['transaction readonly','close']);

 const abort=fake({abortRead:true});
 await assert.rejects(inspectExistingDb('abort-read',{indexedDb:abort.indexedDb}),/AbortError/);
 assert.deepEqual(abort.operations,['transaction readonly','close']);
 await assert.rejects(inspectExistingDb('',{indexedDb:env.indexedDb}),/DB名/);

 const failEstimate=await inspectExistingDb('estimate',{
   indexedDb:fake().indexedDb,
   storageEstimate:async()=>{throw Error('Quota API unavailable')}});
 assert.equal(failEstimate.status,'inspected');
 assert.equal(failEstimate.storageEstimate,null);

 // Plain-text grep checks: current app openers MUST be accounted for before
 // any real migration; this test deliberately does not change those versions.
 assert.match(theater,/indexedDB\.open\(name\)/);
 console.log('RE2-EXH-02: 12 readonly migration checks: v2 blockers, versionless open, absent DB abort, stale version, quota advisory, blocked/read abort, all user data untouched.');
})().catch(error=>{console.error(error);process.exitCode=1});
