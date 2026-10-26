'use strict';
// STO-04: run ACTUAL production helpers in an isolated IndexedDB event model.
// Covers abort-only, error+abort, commit, rejected open retry and specimens.
// No real IndexedDB, user state or localStorage is accessed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const engine = fs.readFileSync('js/pages_preview.js','utf8');
const html = fs.readFileSync('index.html','utf8');
function section(source, from, until) {
  const a = source.indexOf(from), z = source.indexOf(until,a);
  assert.ok(a >= 0 && z > a, 'Source section not found: ' + from);
  return source.slice(a,z);
}
const evolution = section(engine,'  function openDb() {','  // STO-01:') +
  section(engine,'  async function idbEntriesByPrefix(', '  function diagnosticKey(');
const specimen = section(html,'  function openSpecimenDb() {','  function specimenIdentity(') +
  section(html,'  async function specimenPut(', '  async function loadSpecimenGenome(');
assert.match(engine,/async function commitEvolutionGeneration/);
assert.match(engine,/tx\.onabort = \(\) => reject\(failure \|\| tx\.error/);
assert.match(engine,/tx\.onabort = \(\) => reject\(tx\.error \|\| new Error\('世代情報の確認を中断しました/);
assert.match(html,/送信の確認がタイムアウトしました。世代が保存済みの可能性/);
assert.match(html,/const runId = ensureRunId\(\)/);

function simulate(source,isSpecimen=false) {
  const requests=[],transactions=[],openRequests=[],records=new Map(),state={failOpen:false};
  const db={
    objectStoreNames:{contains:()=>true},
    transaction(name,mode) {
      const tx={name,mode,oncomplete:null,onerror:null,onabort:null,error:null,requests:[],
        objectStore(storeName){
          return {
            get(key){const q={result:undefined,error:null,onsuccess:null,onerror:null};
              tx.requests.push({op:'get',key,req:q});return q},
            put(value,key){tx.requests.push({op:'put',key,value})},
            delete(key){tx.requests.push({op:'delete',key})},
            openCursor(){const q={result:null,error:null,onsuccess:null,onerror:null};
              tx.requests.push({op:'cursor',req:q});return q}
          };
        }
      };
      transactions.push(tx);
      return tx;
    }
  };
  const indexedDB={open(name,version){
    const req={error:null,onsuccess:null,onerror:null,onupgradeneeded:null};
    requests.push(req);openRequests.push({name,version,req});
    queueMicrotask(()=>{
      if(state.failOpen){
        state.failOpen=false;
        req.error=Error('TransientInvalidState');
        req.onerror?.();
      }else{req.result=db;req.onsuccess?.();}
    });
    return req;
  }};
  const ctx={indexedDB,dbPromise:null,specimenDbPromise:null,
    DB_NAME:'test-evolution',DB_VERSION:2,IMAGE_STORE:'images',META_STORE:'meta',THEATER_STORE:'theater_frames',
    SPECIMEN_DB_NAME:'test-specimen',SPECIMEN_STORE:'specimens',console,Error};
  vm.runInNewContext(source,ctx,{filename:isSpecimen?'index.html:specimen':'pages_preview.js:indexeddb',timeout:1000});
  const nextTx=async operation=>{
    const old=transactions.length;
    const p=operation();
    await Promise.resolve();await Promise.resolve();await Promise.resolve();
    assert.equal(transactions.length,old+1,'expected one transaction');
    return {tx:transactions.at(-1),p};
  };
  return {ctx,db,transactions,requests,state,nextTx};
}
async function rejects(p,pattern) {
  // Wait for the correct failure rather than hanging on pending promises.
  await assert.rejects(Promise.race([p,new Promise((_,reject)=>
    setTimeout(()=>reject(Error('TEST HUNG: missing abort handler')),500))]),pattern);
}
(async()=>{
  const e=simulate(evolution);
  // If a transaction aborts without a request error, PUT must settle.
  let {tx,p}=await e.nextTx(()=>e.ctx.idbPut('meta','current_generation_id','gen00022'));
  assert.equal(tx.mode,'readwrite');tx.error=Error('QuotaExceededError');tx.onabort();
  await rejects(p,/QuotaExceededError/);
  // onerror then abort may both fire; Promise must settle exactly once.
  ({tx,p}=await e.nextTx(()=>e.ctx.idbPut('meta','key',123)));
  tx.error=Error('QuotaExceededError');tx.onerror();tx.onabort();
  await rejects(p,/QuotaExceededError/);
  // A successful commit still resolves normally; same value/key.
  ({tx,p}=await e.nextTx(()=>e.ctx.idbPut('meta','key',123)));
  assert.equal(tx.requests[0].key,'key');assert.equal(tx.requests[0].value,123);
  tx.oncomplete();await p;
  // DELETE needs the same abort-only behavior.
  ({tx,p}=await e.nextTx(()=>e.ctx.idbDelete('images','gen00022:01')));
  tx.onabort();await rejects(p,/削除が中断/);
  ({tx,p}=await e.nextTx(()=>e.ctx.idbDelete('images','gen00022:01')));
  tx.oncomplete();await p;
  // A read request may succeed and the transaction then abort. It MUST
  // reject rather than returning data from a failed transaction.
  ({tx,p}=await e.nextTx(()=>e.ctx.idbGet('meta','current_generation_id')));
  tx.requests[0].req.result='gen00022';tx.requests[0].req.onsuccess();
  tx.onabort();await rejects(p,/読み込みを中断/);
  ({tx,p}=await e.nextTx(()=>e.ctx.idbGet('meta','current_generation_id')));
  tx.requests[0].req.result='gen00022';tx.requests[0].req.onsuccess();
  tx.oncomplete();assert.equal(await p,'gen00022');
  // Cursor exhaustion is not proof the readonly transaction committed.
  ({tx,p}=await e.nextTx(()=>e.ctx.idbEntriesByPrefix('images','gen00022:')));
  const cursor=tx.requests[0].req;
  cursor.result={key:'gen00022:01',value:'moth',continue(){cursor.result=null;cursor.onsuccess()}};
  cursor.onsuccess();tx.onabort();await rejects(p,/一覧の読み込みを中断/);
  ({tx,p}=await e.nextTx(()=>e.ctx.idbEntriesByPrefix('images','gen00022:')));
  const second=tx.requests[0].req;
  second.result={key:'gen00022:01',value:'moth',continue(){second.result=null;second.onsuccess()}};
  second.onsuccess();tx.oncomplete();
  assert.equal((await p)[0].value,'moth');

  // Failed DB opening is NOT permanently memoized.
  const other=simulate(evolution);
  other.state.failOpen=true;
  await rejects(other.ctx.openDb(),/TransientInvalidState/);
  assert.equal(other.ctx.dbPromise,null);
  assert.ok(await other.ctx.openDb());
  assert.equal(other.requests.length,2);
  assert.strictEqual(await other.ctx.openDb(),other.db);
  assert.equal(other.requests.length,2);

  const s=simulate(specimen,true);
  ({tx,p}=await s.nextTx(()=>s.ctx.specimenPut({id:'moth-1',rank:'S'})));
  tx.onabort();await rejects(p,/標本の保存が中断/);
  ({tx,p}=await s.nextTx(()=>s.ctx.specimenPut({id:'moth-1',rank:'S'})));
  assert.equal(tx.requests[0].value.rank,'S');tx.oncomplete();await p;
  ({tx,p}=await s.nextTx(()=>s.ctx.specimenGet('moth-1')));
  tx.requests[0].req.result={id:'moth-1'};tx.requests[0].req.onsuccess();
  tx.onabort();await rejects(p,/標本の読み込みが中断/);
  ({tx,p}=await s.nextTx(()=>s.ctx.specimenGet('moth-1')));
  tx.requests[0].req.result={id:'moth-1'};tx.requests[0].req.onsuccess();
  tx.oncomplete();assert.equal((await p).id,'moth-1');
  ({tx,p}=await s.nextTx(()=>s.ctx.specimenAll()));
  tx.onabort();await rejects(p,/標本一覧の読み込みが中断/);
  const retry=simulate(specimen,true);retry.state.failOpen=true;
  await rejects(retry.ctx.openSpecimenDb(),/TransientInvalidState/);
  assert.equal(retry.ctx.specimenDbPromise,null);
  await retry.ctx.openSpecimenDb();assert.equal(retry.requests.length,2);
  console.log('STO-04: evolution+specimens abort-only, error/abort, read-after-transaction, successful commits and failed DB open retry verified.');
})().catch(err=>{console.error(err);process.exitCode=1});
