'use strict';
// STO-03: execute the REAL delete/clear handlers under a blocked -> success
// IndexedDB event sequence. No browser databases or user saves are touched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const saves = fs.readFileSync('js/experiment_saves.js','utf8');
const engine = fs.readFileSync('js/pages_preview.js','utf8');
const deleteStart = saves.indexOf('  let pendingDeletion = false;');
const deleteEnd = saves.indexOf('  async function renameSavedRecord(',deleteStart);
assert.ok(deleteStart >= 0 && deleteEnd > deleteStart);
const deleteCode = saves.slice(deleteStart,deleteEnd);
assert.match(deleteCode, /request\.onblocked = \(\) => \{/);
assert.doesNotMatch(deleteCode, /request\.onblocked = \(\) => reject\(/);
assert.match(deleteCode,/request\.onsuccess = \(\) => resolve\(\)/);
assert.match(deleteCode,/pendingDeletion = false/);
const clearStart=engine.indexOf('  async function clearDb() {');
const clearEnd=engine.indexOf('\n  async function getSaveState()',clearStart);
assert.ok(clearStart >= 0 && clearEnd > clearStart);
const clearCode=engine.slice(clearStart,clearEnd);
assert.match(clearCode,/req\.onblocked = \(\) => \{/);
assert.doesNotMatch(clearCode,/req\.onblocked = \(\) => reject\(/);
const openStart=engine.indexOf('  function openDb() {');
const openEnd=engine.indexOf('\n  async function idbGet(',openStart);
const openCode=engine.slice(openStart,openEnd);
assert.match(openCode,/db\.onversionchange = \(\) => \{/);
assert.doesNotMatch(openCode,/db\.onversionchange = \(\) => \{[^}]*db\.close\(\)/);

async function tick(){await new Promise(done=>setTimeout(done,0))}
function createDeletionFixture({confirm=true,records=null,current='current'}={}){
 const target={id:'exp_2',dbName:'db-2',name:'Second evolution'};
 const all=records||[target,{id:'exp_2',dbName:'db-3',name:'Other with same id'},{
   id:'exp_4',dbName:'db-4',name:'Fourth'}];
 const store=new Map([['gitai-experiment-records-v1',JSON.stringify({version:1,records:all})],
  ['gitai-warning-life-v1:db-2','6']]);
 const reqs=[],events={},state={messages:[],show:0,registryWrites:0},message={textContent:''};
 const localStorage={
  getItem:key=>store.has(key)?store.get(key):null,
  setItem:(key,value)=>store.set(key,value),
  removeItem:key=>store.delete(key)
 };
 const ctx={
  dbName:current,
  indexedDB:{deleteDatabase:name=>{const request={};reqs.push({name,request});return request}},
  window:{confirm:()=>confirm,addEventListener:(type,callback)=>{events[type]=callback}},
  localStorage,
  message,
  readRegistry:()=>JSON.parse(store.get('gitai-experiment-records-v1')).records,
  writeRegistry:rs=>{state.registryWrites++;localStorage.setItem('gitai-experiment-records-v1',
    JSON.stringify({version:1,records:rs}))},
  showRecords:async()=>{state.show++},
  Error
 };
 vm.runInNewContext(deleteCode+
   '\nglobalThis.removeSaved=deleteSavedRecord;globalThis.isPending=()=>pendingDeletion;',
  ctx,{filename:'experiment_saves.js:deleteSavedRecord',timeout:1000});
 return {ctx,target,reqs,events,store,state,message,
  records:()=>ctx.readRegistry(),
  remove:record=>ctx.removeSaved(record||target)};
}
async function testDeleteBlockedSuccess(){
 const f=createDeletionFixture();
 let settled=false;
 const promise=f.remove().finally(()=>{settled=true});
 assert.equal(f.reqs.length,1);
 assert.equal(f.reqs[0].name,'db-2');
 f.reqs[0].request.onblocked();
 await tick();
 assert.equal(settled,false,'blocked must NEVER finish a deletion request');
 assert.equal(f.ctx.isPending(),true);
 assert.match(f.message.textContent,/別のタブ/);
 assert.equal(f.state.registryWrites,0);
 assert.equal(f.records().length,3);
 assert.equal(f.store.get('gitai-warning-life-v1:db-2'),'6');
 const event={preventDefaultCalled:false,returnValue:undefined,
   preventDefault(){this.preventDefaultCalled=true}};
 f.events.beforeunload(event);
 assert.equal(event.preventDefaultCalled,true,'Warn if a waiting deletion tab navigates away');
 f.reqs[0].request.onsuccess();
 await promise;
 assert.equal(settled,true);
 assert.equal(f.ctx.isPending(),false);
 assert.equal(f.state.registryWrites,1);
 assert.equal(f.state.show,1);
 assert.equal(f.records().length,2);
 assert.ok(f.records().some(x=>x.dbName==='db-3'),
   'A different database with a reused ID must stay registered');
 assert.equal(f.store.has('gitai-warning-life-v1:db-2'),false);
 assert.match(f.message.textContent,/削除しました/);
 const after={prevented:false,returnValue:null,preventDefault(){this.prevented=true}};
 f.events.beforeunload(after);
 assert.equal(after.prevented,false);
}
async function testDeleteErrorAfterBlocked(){
 const f=createDeletionFixture();
 const promise=f.remove();
 f.reqs[0].request.onblocked();
 f.reqs[0].request.error=Error('DiskFailure');
 f.reqs[0].request.onerror();
 await assert.rejects(promise,/DiskFailure/);
 assert.equal(f.ctx.isPending(),false);
 assert.equal(f.state.registryWrites,0);
 assert.equal(f.records().length,3);
 assert.equal(f.store.get('gitai-warning-life-v1:db-2'),'6');
}
async function testCancelledAndCurrent(){
 const c=createDeletionFixture({confirm:false});
 await c.remove();
 assert.equal(c.reqs.length,0);
 assert.equal(c.state.registryWrites,0);
 const current=createDeletionFixture({current:'db-2'});
 await assert.rejects(current.remove(),/現在開いている実験/);
 assert.equal(current.reqs.length,0);
}
async function testEngineClearBlocked(){
 const requests=[],notes=[],closed=[];
 const db={close(){closed.push(1)}};
 const ctx={
  dbPromise:Promise.resolve(db),DB_NAME:'db-current',
  indexedDB:{deleteDatabase(name){const request={};requests.push({name,request});return request}},
  showStorageConflictNotice:msg=>notes.push(msg),
  Error
 };
 vm.runInNewContext(clearCode+'\nglobalThis.runClear=clearDb',ctx,
   {filename:'pages_preview.js:clearDb',timeout:1000});
 let settled=false;
 const promise=ctx.runClear().then(()=>{settled=true});
 await tick();
 assert.equal(closed.length,1,'Close only the current tab connection before reset');
 assert.equal(requests.length,1);
 requests[0].request.onblocked();
 await tick();
 assert.equal(settled,false);
 assert.match(notes[0],/初期化を待機/);
 requests[0].request.onsuccess();
 await promise;
 assert.equal(settled,true);
 assert.equal(ctx.dbPromise,null);
 // Failure after blocked must reject, never claim the reset completed.
 const p2=ctx.runClear();
 await tick();
 requests[1].request.onblocked();
 requests[1].request.error=Error('DeleteFailure');
 requests[1].request.onerror();
 await assert.rejects(p2,/DeleteFailure/);
}
async function testActiveTabVersionchange(){
 const notes=[],openRequests=[],connections=[];
 const ctx={
  dbPromise:null,DB_NAME:'db-current',DB_VERSION:2,
  IMAGE_STORE:'images',META_STORE:'meta',THEATER_STORE:'theater_frames',
  indexedDB:{open(name,version){
    const req={};
    openRequests.push(req);
    queueMicrotask(()=>{
      const db={
        closed:false,close(){this.closed=true},
        objectStoreNames:{contains:()=>true}
      };
      connections.push(db);
      req.result=db;req.onsuccess();
    });
    return req;
  }},
  showStorageConflictNotice:msg=>notes.push(msg),Error
 };
 vm.runInNewContext(openCode+'\nglobalThis.tryOpen=openDb',ctx,
   {filename:'pages_preview.js:openDb',timeout:1000});
 const db=await ctx.tryOpen();
 assert.equal(typeof db.onversionchange,'function');
 db.onversionchange({newVersion:null});
 assert.match(notes[0],/別のタブ/);
 assert.equal(db.closed,false,'Do not auto-close an active, potentially uncommitted game');
}
(async()=>{
 await testDeleteBlockedSuccess();
 await testDeleteErrorAfterBlocked();
 await testCancelledAndCurrent();
 await testEngineClearBlocked();
 await testActiveTabVersionchange();
 assert.match(saves,/if \(busy\) return;/);
 assert.match(saves,/close\.disabled = true/);
 assert.match(saves,/dialog\.setAttribute\('aria-busy', 'true'\)/);
 console.log('STO-03: blocked->success, blocked->error, cancellations, registry/life cleanup, reset waiting and active-tab warning OK');
})().catch(error=>{console.error(error);process.exitCode=1});
