'use strict';
// STO-04: execute actual saved-experiment IndexedDB opener with synthetic
// requests. Never open or delete any user database.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('js/experiment_saves.js','utf8');
const start=source.indexOf('  function openDatabase(name) {');
const end=source.indexOf('  async function storedGeneration(',start);
assert.ok(start>0&&end>start);
const actual=source.slice(start,end);
assert.match(actual,/if \(blocked\) \{\s*db\.close\(\);\s*return;/);
assert.match(actual,/req\.transaction\.abort\(\)/,
  'missing experiment DB must still be aborted without new blank saves');

function harness(){
 const requests=[],opened=[];
 const ctx={indexedDB:{open(name) {
   opened.push(name);
   const req={result:null,error:null,transaction:{
     abort(){req.aborted=true;}
   }};
   requests.push(req);
   return req;
 }},Error};
 vm.runInNewContext(actual+'\nglobalThis.openSavedDb=openDatabase;',ctx,{
   filename:'js/experiment_saves.js:openDatabase',timeout:2500
 });
 const db=()=>{let closes=0;return {close(){closes++},get closed(){return closes}}};
 return {open:name=>ctx.openSavedDb(name),db,requests,opened};
}
(async()=>{
 const a=harness(),pa=a.open('saved-run-a');
 assert.deepEqual(a.opened,['saved-run-a']);
 const conn=a.db();
 a.requests[0].result=conn;
 a.requests[0].onsuccess();
 assert.equal(await pa,conn,'unblocked open must return usable DB');
 assert.equal(conn.closed,0,'caller must own and close successful connection');
 conn.close();
 assert.equal(conn.closed,1);

 const blocked=harness(),pb=blocked.open('saved-run-b');
 blocked.requests[0].onblocked();
 await assert.rejects(pb,/別のタブで使用中/);
 const late=blocked.db();
 blocked.requests[0].result=late;
 blocked.requests[0].onsuccess();
 assert.equal(late.closed,1,'late success after rejected blocked open MUST close DB');
 assert.equal(blocked.opened.length,1,'never retry or create DB automatically');

 const blockedError=harness(),pe=blockedError.open('saved-run-c');
 blockedError.requests[0].onblocked();
 await assert.rejects(pe,/別のタブで使用中/);
 blockedError.requests[0].error=Error('Test late error');
 blockedError.requests[0].onerror();
 assert.equal(blockedError.opened.length,1);

 const missing=harness(),pm=missing.open('saved-run-missing');
 missing.requests[0].onupgradeneeded();
 assert.equal(missing.requests[0].aborted,true,'must abort auto-create v1');
 missing.requests[0].onerror();
 await assert.rejects(pm,/保存された実験データが見つかりません/);

 const error=harness(),px=error.open('saved-run-failed');
 error.requests[0].error=Error('Synthetic SecurityError');
 error.requests[0].onerror();
 await assert.rejects(px,/Synthetic SecurityError/);

 // A second user-initiated open after a blocked attempt succeeds normally.
 const later=harness(),p1=later.open('saved-run-retry');
 later.requests[0].onblocked();
 await assert.rejects(p1,/別のタブ/);
 const p2=later.open('saved-run-retry');
 const c2=later.db();later.requests[1].result=c2;later.requests[1].onsuccess();
 assert.equal(await p2,c2);
 assert.equal(c2.closed,0);
 const c1=later.db();later.requests[0].result=c1;later.requests[0].onsuccess();
 assert.equal(c1.closed,1,'old pending request cannot retain a connection');
 assert.equal(c2.closed,0,'new connection must remain owned by its caller');
 c2.close();

 console.log('STO-04: late opened DB after blocked request closes; ordinary open, missing-name abort, errors and explicit retry remain correct. No real IndexedDB opened.');
})().catch(error=>{console.error(error);process.exitCode=1});
