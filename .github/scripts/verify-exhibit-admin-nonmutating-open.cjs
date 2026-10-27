'use strict';
// AUD-DB-01: execute production admin open and count-preflight helpers in a
// deterministic IndexedDB mock. Never open a real game database.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync('exhibit/admin.js','utf8');
function extract(from,to){
  const i=src.indexOf(from),j=src.indexOf(to,i+from.length);
  assert.ok(i>=0&&j>i,'Source markers missing: '+from);
  return src.slice(i,j);
}
const openCode=extract('  async function openDb(name) {','  // RE2-EXH-02:');
const countCode=extract('  function preflightExportEntryCount(db) {','  function snapshotStores(db) {');
const exportCode=extract('  async function exportMode(modeId) {','  // Existing export encoding');
assert.match(src,/const MAX_BACKUP_ENTRIES = 20000/);
assert.match(openCode,/indexedDB\.open\(name\)/);
assert.doesNotMatch(openCode,/indexedDB\.open\(name,\s*2\)/);
assert.doesNotMatch(openCode,/createObjectStore|\.put\(|\.delete\(|\.clear\(/);
assert.match(openCode,/request\.onupgradeneeded = event =>/);
assert.match(openCode,/event\.target\.transaction\.abort\(\)/);
assert.match(openCode,/db\.version !== 2/);
assert.match(exportCode,/await preflightExportEntryCount\(db\);\s*snapshot = await snapshotStores\(db\)/);
assert.match(exportCode,/finally \{ db\.close\(\); \}/);
const STORES=['images','meta','theater_frames'];
function opening({exists=true,version=2,missingStore=null,blocked=false,
                  failed=false}={}){
  let attempts=0,created=0,abortedCreation=0,closes=0,openedWithVersion=[];
  const names=STORES.filter(n=>n!==missingStore);
  const db={
    version,objectStoreNames:{contains:n=>names.includes(n)},
    close(){closes++},
    createObjectStore(){created++;throw Error('Admin must never create a store')}
  };
  const indexedDB={
    open(name,requestedVersion){
      attempts++;openedWithVersion.push(requestedVersion);
      assert.equal(name,'test-exhibit');
      const req={error:null,result:null,onupgradeneeded:null,onerror:null,
        onsuccess:null,onblocked:null};
      queueMicrotask(()=>{
        if(failed){
          req.error=Error('Transient IDB error');req.onerror?.();return;
        }
        if(!exists){
          req.onupgradeneeded?.({target:{transaction:{
            abort(){
              abortedCreation++;
              req.error=Error('AbortError');
              queueMicrotask(()=>req.onerror?.());
            }
          }}});
          return;
        }
        if(blocked)req.onblocked?.();
        req.result=db;req.onsuccess?.();
      });
      return req;
    }
  };
  const c={indexedDB,STORES,Error};
  vm.runInNewContext(openCode+'\nglobalThis.testOpen=openDb;',c,{
    filename:'admin.js:openDb',timeout:1500});
  return {open:()=>c.testOpen('test-exhibit'),db,
    get attempts(){return attempts},
    get aborts(){return abortedCreation},
    get created(){return created},
    get closes(){return closes},
    get versions(){return openedWithVersion}};
}
function countDb(counts,mode='complete'){
  let reads=0,cursorReads=0,transactions=0,txAborts=0;
  const db={transaction(stores,kind){
    transactions++;
    assert.deepEqual([...stores],STORES);
    assert.equal(kind,'readonly');
    const tx={
      error:null,oncomplete:null,onabort:null,onerror:null,
      abort(){txAborts++;tx.onabort?.();}
    };
    let pending=STORES.length;
    tx.objectStore=name=>({
      count(){
        reads++;
        const req={error:null,result:undefined,onsuccess:null,onerror:null};
        queueMicrotask(()=>{
          if(mode==='abort'){
            if(pending===STORES.length)tx.onabort?.();
            return;
          }
          if(mode==='error'&&name==='meta'){
            req.error=Error('Synthetic count failure');req.onerror?.();
            return;
          }
          req.result=counts[name];
          req.onsuccess?.();
          if(--pending===0)queueMicrotask(()=>tx.oncomplete?.());
        });
        return req;
      },
      openCursor(){cursorReads++;throw Error('Should not cursor-read backup on preflight')}
    });
    return tx;
  }};
  const c={STORES,MAX_BACKUP_ENTRIES:20000,Error};
  vm.runInNewContext(countCode+'\nglobalThis.preflight=preflightExportEntryCount;',c,{
    filename:'admin.js:preflightExportEntryCount',timeout:1500});
  return {run:()=>c.preflight(db),
    get reads(){return reads},get cursors(){return cursorReads},
    get transactions(){return transactions},get aborts(){return txAborts}};
}
(async()=>{
  // Established game DB: version 2, all stores; admin never requests upgrade.
  const valid=opening();
  assert.strictEqual(await valid.open(),valid.db);
  assert.deepEqual(valid.versions,[undefined]);
  assert.equal(valid.created,0);
  assert.equal(valid.aborts,0);
  assert.equal(valid.closes,0);

  // Unplayed mode: IndexedDB would otherwise silently create a v1 DB.
  // Reject explicitly and abort creation BEFORE anything is committed.
  const fresh=opening({exists:false});
  await assert.rejects(fresh.open(),/まだ実験データがありません/);
  assert.equal(fresh.aborts,1);
  assert.equal(fresh.created,0);
  assert.deepEqual(fresh.versions,[undefined]);
  // Old schema must not be silently upgraded by a backup button.
  const old=opening({version:1});
  await assert.rejects(old.open(),/バージョンまたは形式が想定と異なります/);
  assert.equal(old.closes,1);
  assert.equal(old.created,0);
  assert.deepEqual(old.versions,[undefined]);
  // Future schema must be treated as read-only incompatible, not downgraded.
  const future=opening({version:3});
  await assert.rejects(future.open(),/バージョンまたは形式/);
  assert.equal(future.closes,1);
  const incomplete=opening({missingStore:'theater_frames'});
  await assert.rejects(incomplete.open(),/バージョンまたは形式/);
  assert.equal(incomplete.closes,1);

  // STI-04: a blocked request can succeed late; close the orphan.
  const blocked=opening({blocked:true});
  await assert.rejects(blocked.open(),/データベースが使用中/);
  await Promise.resolve();await Promise.resolve();
  assert.equal(blocked.closes,1);
  const transient=opening({failed:true});
  await assert.rejects(transient.open(),/Transient IDB error/);

  const below=countDb({images:8000,meta:8000,theater_frames:3999});
  assert.equal(await below.run(),19999);
  assert.equal(below.reads,3);
  assert.equal(below.transactions,1);
  assert.equal(below.cursors,0);
  const atLimit=countDb({images:10000,meta:9500,theater_frames:500});
  assert.equal(await atLimit.run(),20000,
    'Existing 20,000-entry limit is inclusive');
  const tooMany=countDb({images:10000,meta:9500,theater_frames:501});
  await assert.rejects(tooMany.run(),/20,000件を超えています/);
  assert.equal(tooMany.cursors,0,'Reject BEFORE reading any large PNG Blob');
  assert.equal(tooMany.transactions,1);
  const empty=countDb({images:0,meta:0,theater_frames:0});
  assert.equal(await empty.run(),0);
  const invalid=countDb({images:1,meta:-1,theater_frames:1});
  await assert.rejects(invalid.run(),/件数が不正|件数を検証/);
  const failedCount=countDb({images:1,meta:1,theater_frames:1},'error');
  await assert.rejects(failedCount.run(),/Synthetic count failure/);
  assert.ok(failedCount.aborts>=1);
  const aborted=countDb({images:1,meta:1,theater_frames:1},'abort');
  await assert.rejects(aborted.run(),/中断/);

  console.log('AUD-DB-01: admin never creates or upgrades a DB; nonexistent/old/future/missing-store rejected, late blocked connections closed; read-only 20k count rejects before binary cursor reads.');
})().catch(e=>{console.error(e);process.exitCode=1});
