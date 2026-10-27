'use strict';
// STO-01: execute the real commitEvolutionGeneration() from pages_preview.js
// on a tiny transactional IndexedDB model; no user DB or browser data touched.
const assert = require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('js/pages_preview.js','utf8');
const start=source.indexOf('  function completedRunKey(');
const end=source.indexOf('\n  async function idbEntriesByPrefix(',start);
assert.ok(start>0&&end>start,'Atomic commit functions not found');
const fn=source.slice(start,end);
assert.match(fn,/db\.transaction\(\[IMAGE_STORE, META_STORE\], 'readwrite'\)/);
assert.match(fn,/meta\.get\('current_generation_id'\)/);
assert.match(fn,/meta\.put\(nextId, 'current_generation_id'\)/);
assert.match(fn,/completedRunKey\(runId\)/);
assert.match(fn,/tx\.abort\(\)/);
assert.doesNotMatch(fn,/await idbPut\(/);
for (const name of ['Legacy','ByMorph','ByGenome']) {
 const found=source.match(new RegExp('async function evolveGeneration'+name+'\\([\\s\\S]*?\\n  \\}', 'm'));
 assert.ok(found, 'Evolution model branch missing: '+name);
 assert.match(found[0],/commitEvolutionGeneration\(/,'Model branch must use atomic commit: '+name);
 assert.doesNotMatch(found[0],/idbPut\(META_STORE, 'current_generation_id'/,
  'No separate generation pointer writes: '+name);
}
assert.match(source,/const already = completedRuns\.get\(runId\)/);
assert.match(source,/await persistedCompletedRun\(runId\)/);
assert.match(source,/runId\.length > 128/);
assert.match(source,/error\?\.code === 'generation_mismatch'/);

function dbFixture(sourceId='gen00021',failAt=Infinity) {
 const stores={images:new Map(),meta:new Map()};
 stores.meta.set('current_generation_id',sourceId);
 for(let i=1;i<=60;i++) {
  const suffix=String(i).padStart(2,'0');
  stores.images.set(sourceId+':'+suffix,new Blob(['old']));
  stores.meta.set('genome:'+sourceId+':'+suffix,{marker:'old'});
 }
 const txLog=[], pending=[];
 let busy=false, writes=0;
 function startNext() {
  if(busy || !pending.length)return;
  busy=true;
  const tx=pending.shift();
  const stage={images:new Map(stores.images),meta:new Map(stores.meta)};
  let cancelled=false;
  function abort(reason){
   if(cancelled)return;
   cancelled=true;
   tx.error=reason || Error('AbortError');
   setImmediate(()=>{
    busy=false;tx.onabort?.();startNext();
   });
  }
  tx.abort=()=>abort(Error('AbortError'));
  const operations=tx.operations;
  function cycle(){
   if(cancelled)return;
   if(!operations.length){
    for (const name of ['images','meta'])stores[name]=stage[name];
    setImmediate(()=>{busy=false;tx.oncomplete?.();startNext()});
    return;
   }
   const item=operations.shift();
   try{
    if(item.type==='get'){
     item.request.result=stage[item.store].get(item.key);
     item.request.onsuccess?.();
    }else{
     if(item.type==='put' && ++writes===failAt){
      throw Error('QuotaExceededError');
     }
     if(item.type==='put')stage[item.store].set(item.key,item.value);
     else stage[item.store].delete(item.key);
    }
    setImmediate(cycle);
   }catch(err){abort(err)}
  }
  setImmediate(cycle);
 }
 const database={
  transaction(names,mode) {
   assert.deepEqual(Array.from(names),['images','meta']);
   assert.equal(mode,'readwrite');
   const tx={operations:[],error:null,oncomplete:null,onabort:null,onerror:null,
    objectStore(name){
     assert.ok(['images','meta'].includes(name));
     return {
      get(key){const request={result:undefined,onsuccess:null};tx.operations.push({type:'get',store:name,key,request});return request},
      put(value,key){tx.operations.push({type:'put',store:name,key,value})},
      delete(key){tx.operations.push({type:'delete',store:name,key})}
     };
    }
   };
   txLog.push(tx);pending.push(tx);startNext();
   return tx;
  }
 };
 const context={
  IMAGE_STORE:'images',META_STORE:'meta',TOTAL:60,Blob,
  imageKey:(gen,i)=>gen+':'+String(i).padStart(2,'0'),
  genomeKey:(gen,i)=>'genome:'+gen+':'+String(i).padStart(2,'0'),
  diagnosticKey:gen=>'diagnostic:'+gen,
  openDb:async()=>database,
  idbGet:async(store,key)=>stores[store].get(key),
  console,Date,Error,loadedRestoreEpoch:null
 };
 vm.runInNewContext(fn+'\nglobalThis.commit=commitEvolutionGeneration;globalThis.replay=persistedCompletedRun;',
  context,{filename:'js/pages_preview.js:commitEvolutionGeneration',timeout:5000});
 const make=(marker,genomes=true)=>{
  const blobs=new Map(),dna=genomes?new Map():null;
  for(let i=1;i<=60;i++){blobs.set(i,new Blob([marker]));if(dna)dna.set(i,{marker,index:i,schema_version:1})}
  return {blobs,dna,diag:{marker,offspring:[{marker}]}};
 };
 return {stores,txLog,make,commit:(from,to,data,runId)=>context.commit(
  from,to,data.blobs,data.dna,data.diag,runId),replay:id=>context.replay(id)};
}
(async()=>{
 const a=dbFixture();const first=a.make('first'),second=a.make('second');
 const result=await Promise.allSettled([
  a.commit('gen00021','gen00022',first,'run-1'),
  a.commit('gen00021','gen00022',second,'run-2')
 ]);
 assert.equal(result.filter(x=>x.status==='fulfilled').length,1,
  'Two tabs cannot both commit the same generation');
 assert.equal(result.filter(x=>x.status==='rejected').length,1);
 const winner=result[0].status==='fulfilled'?'first':'second';
 assert.equal(a.stores.meta.get('current_generation_id'),'gen00022');
 assert.equal(a.stores.images.size,60);
 for(let i=1;i<=60;i++){
  const key='gen00022:'+String(i).padStart(2,'0');
  assert.equal(await a.stores.images.get(key).text(),winner);
  assert.equal(a.stores.meta.get('genome:'+key).marker,winner);
 }
 assert.equal(a.stores.meta.get('diagnostic:gen00021').marker,winner);
 assert.ok(await a.replay(winner==='first'?'run-1':'run-2'));
 assert.equal(await a.replay(winner==='first'?'run-2':'run-1'),null);

 const same=dbFixture();
 const dupe=await Promise.allSettled([
  same.commit('gen00021','gen00022',same.make('a'),'same-run'),
  same.commit('gen00021','gen00022',same.make('b'),'same-run')
 ]);
 assert.equal(dupe.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(same.stores.meta.get('completed_run:same-run').generation_id,'gen00021');
 assert.equal(same.stores.meta.get('completed_run:same-run').next_generation_id,'gen00022');

 const restored=dbFixture('gen00021');
 // ABA: another tab restores different DNA at exactly the same generation ID.
 for(let i=1;i<=60;i++) {
   const key='gen00021:'+String(i).padStart(2,'0');
   restored.stores.images.set(key,new Blob(['restored-B']));
   restored.stores.meta.set('genome:'+key,{marker:'restored-B'});
 }
 restored.stores.meta.set('restore_epoch','restore-B');
 await assert.rejects(
   restored.commit('gen00021','gen00022',restored.make('stale-A'),'old-tab-run'),
   /復元されました/
 );
 assert.equal(restored.stores.meta.get('current_generation_id'),'gen00021');
 assert.equal(restored.stores.meta.get('restore_epoch'),'restore-B');
 assert.equal(restored.stores.meta.has('completed_run:old-tab-run'),false);
 for(let i=1;i<=60;i++){
   const key='gen00021:'+String(i).padStart(2,'0');
   assert.equal(await restored.stores.images.get(key).text(),'restored-B');
   assert.equal(restored.stores.meta.get('genome:'+key).marker,'restored-B');
 }

 const stale=dbFixture('gen00022');
 await assert.rejects(
  stale.commit('gen00021','gen00022',stale.make('stale'),'old-run'),
  /別の画面で世代が進みました/
 );
 assert.equal(stale.stores.meta.get('current_generation_id'),'gen00022');
 assert.equal(stale.stores.images.size,60);

 const quota=dbFixture('gen00021',35);
 await assert.rejects(
  quota.commit('gen00021','gen00022',quota.make('new'),'failing-run'),
  /QuotaExceededError|保存が中断/
 );
 assert.equal(quota.stores.meta.get('current_generation_id'),'gen00021');
 assert.equal(quota.stores.meta.has('completed_run:failing-run'),false);
 assert.equal(quota.stores.images.size,60);
 assert.equal(quota.stores.meta.has('diagnostic:gen00021'),false);
 for(let i=1;i<=60;i++)assert.equal(
  await quota.stores.images.get('gen00021:'+String(i).padStart(2,'0')).text(),'old');

 const gen1=dbFixture('gen00001');
 await gen1.commit('gen00001','gen00002',gen1.make('child'),'gen1-run');
 assert.equal(gen1.stores.images.size,120,'Founders remain available for theater');
 const legacy=dbFixture('gen00021');
 const noGenome=legacy.make('legacy',false);
 await legacy.commit('gen00021','gen00022',noGenome,'morph-legacy-run');
 assert.equal(legacy.stores.images.size,60);
 assert.equal(legacy.stores.meta.get('current_generation_id'),'gen00022');

 const incomplete=dbFixture();
 const missing=incomplete.make('incomplete');
 missing.blobs.delete(60);
 await assert.rejects(incomplete.commit('gen00021','gen00022',missing,'broken'),/60個揃っていません/);
 assert.equal(incomplete.txLog.length,0,'Missing offspring rejected before transaction');
 console.log('STO-01: serializable two-tab CAS; duplicate run, stale generation, atomic quota rollback, 60 image/genome cohesion, founder retention, legacy path OK');
})().catch(e=>{console.error(e);process.exitCode=1});
