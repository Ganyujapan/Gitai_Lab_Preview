'use strict';
// RE2-EV-01: execute the actual atomic founder checkpoint transaction in
// isolated in-memory IndexedDB. No actual user records or RNG are touched.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('js/pages_preview.js','utf8');
const start=source.indexOf('  async function commitFounderCheckpoint(');
const end=source.indexOf('\n  async function ensureFounderGeneration(',start);
assert.ok(start>0 && end>start,'founder transaction not found');
const impl=source.slice(start,end);
const ensureStart=source.indexOf('  async function ensureFounderGeneration(');
const ensureEnd=source.indexOf('\n  // Warning-color experiment:',ensureStart);
assert.ok(ensureStart>0 && ensureEnd>ensureStart);
const founderBody=source.slice(ensureStart,ensureEnd);
assert.match(founderBody,/await commitFounderCheckpoint\(markerKey, expectedMarker, \{/);
assert.match(founderBody,/await commitFounderCheckpoint\(markerKey, expectedMarker\)/);
assert.doesNotMatch(founderBody,/await idbPut\(/);
function fixture({warning=false,failPutAt=Infinity}={}){
 let busy=false,putCount=0;const pending=[];
 const data={
  images:new Map(),meta:new Map(),theater_frames:new Map()
 };
 const toKey=i=>'gen00001:'+String(i).padStart(2,'0');
 const toGenome=i=>'genome:'+toKey(i);
 function next(){
  if(busy||!pending.length)return;
  busy=true;const tx=pending.shift();
  const draft=Object.fromEntries(Object.entries(data).map(([k,v])=>[k,new Map(v)]));
  let aborted=false;
  tx.abort=()=>{
   if(aborted)return;
   aborted=true;
   queueMicrotask(()=>{busy=false;tx.onabort?.();next();});
  };
  function cycle(){
   if(aborted)return;
   const item=tx.queue.shift();
   if(!item) {
    for(const name of Object.keys(data))data[name]=draft[name];
    queueMicrotask(()=>{busy=false;tx.oncomplete?.();next()});
    return;
   }
   try{
    if(item.op==='get'||item.op==='getAllKeys'){
      item.req.result=item.op==='get'
        ? draft[item.store].get(item.key) : [...draft[item.store].keys()];
      item.req.onsuccess?.();
    } else if(item.op==='put'){
      if(++putCount===failPutAt)throw Error('QuotaExceededError');
      draft[item.store].set(item.key,item.value);
    }
    queueMicrotask(cycle);
   }catch(e){tx.error=e;tx.abort();}
  }
  queueMicrotask(cycle);
 }
 const db={transaction(names,mode){
   assert.deepEqual(Array.from(names),['images','meta','theater_frames']);
   assert.equal(mode,'readwrite');
   const tx={queue:[],error:null,objectStore(name){
     assert.ok(data[name]);
     return {
       get(key){const req={result:undefined,onsuccess:null};tx.queue.push({op:'get',store:name,key,req});return req;},
       getAllKeys(){const req={result:undefined,onsuccess:null};tx.queue.push({op:'getAllKeys',store:name,req});return req;},
       put(value,key){tx.queue.push({op:'put',store:name,key,value});}
     };
   }};
   pending.push(tx);next();return tx;
 }};
 const ctx={
  openDb:async()=>db,Blob,Error,TOTAL:60,
  IMAGE_STORE:'images',META_STORE:'meta',THEATER_STORE:'theater_frames',
  WARNING_EXPERIMENT:warning,
  imageKey:toKey,genomeKey:toGenome
 };
 vm.runInNewContext(impl+'\nglobalThis.commit=commitFounderCheckpoint;',ctx,
   {filename:'js/pages_preview.js:founder-checkpoint',timeout:5000});
 const marker='continuous_v1:standard_white_001:standard_white_001';
 function prepare(){
   const blobs=new Map(),genomes=new Map();
   for(let i=1;i<=60;i++){
     blobs.set(i,new Blob(['pixels-'+i],{type:'image/png'}));
     genomes.set(i,{schema_version:1,baseValue:1,individual:i});
   }
   return {blobs,genomes};
 }
 return {
  data,marker,prepare,
  fresh:()=>ctx.commit('founder_generation_identity',marker,prepare()),
  recover:()=>ctx.commit('founder_generation_identity',marker),
  imageKey:toKey,genomeKey:toGenome
 };
}
(async()=>{
 const f=fixture();
 await f.fresh();
 assert.equal(f.data.meta.get('current_generation_id'),'gen00001');
 assert.equal(f.data.meta.get('founder_generation_identity'),f.marker);
 assert.equal(f.data.images.size,60);
 assert.equal(f.data.meta.size,62,'exactly 60 genomes, identity, pointer');
 assert.equal((await f.data.images.get(f.imageKey(20)).text()),'pixels-20');
 await assert.rejects(f.fresh(),/他の画面|未完成/);
 assert.equal(f.data.meta.get('current_generation_id'),'gen00001');

 const old=fixture();
 for(let i=1;i<=60;i++){
   old.data.images.set(old.imageKey(i),new Blob(['old-png-'+i]));
   old.data.meta.set(old.genomeKey(i),{schema_version:1,id:i});
 }
 old.data.meta.set('founder_generation_identity',old.marker);
 await old.recover();
 assert.equal(old.data.meta.get('current_generation_id'),'gen00001');
 assert.equal(await old.data.images.get(old.imageKey(10)).text(),'old-png-10');
 assert.equal(old.data.meta.get(old.genomeKey(10)).id,10);
 await assert.rejects(old.recover(),/復旧できません/);

 for(const broken of ['image','genome','marker','later-image','later-genome','later-frame','later-diagnostic','wrong-pointer','restore']){
   const k=fixture();for(let i=1;i<=60;i++){
     k.data.images.set(k.imageKey(i),new Blob(['kept-'+i]));
     k.data.meta.set(k.genomeKey(i),{schema_version:1,individual:i});
   }
   k.data.meta.set('founder_generation_identity',k.marker);
   if(broken==='image')k.data.images.delete(k.imageKey(40));
   if(broken==='genome')k.data.meta.delete(k.genomeKey(40));
   if(broken==='marker')k.data.meta.set('founder_generation_identity','different-founder');
   if(broken==='later-image')k.data.images.set('gen00234:01',new Blob(['history']));
   if(broken==='later-genome')k.data.meta.set('genome:gen00234:01',{schema_version:1});
   if(broken==='later-frame')k.data.theater_frames.set('gen00234',new Blob(['history']));
   if(broken==='later-diagnostic')k.data.meta.set('diagnostic:gen00021',{status:'past'});
   if(broken==='wrong-pointer')k.data.meta.set('current_generation_id','gen00234');
   if(broken==='restore')k.data.meta.set('restore_epoch','restore-existing');
   await assert.rejects(k.recover(),/初代|復旧できません/);
   assert.equal(k.data.meta.get('current_generation_id'),
     broken==='wrong-pointer'?'gen00234':undefined,broken);
   assert.equal(await k.data.images.get(k.imageKey(10)).text(),'kept-10');
 }
 const partial=fixture();
 partial.data.images.set(partial.imageKey(1),new Blob(['partial']));
 await assert.rejects(partial.fresh(),/他の画面|未完成/);
 assert.equal(partial.data.images.size,1);
 assert.equal(partial.data.meta.has('current_generation_id'),false);

 const quota=fixture({failPutAt:38});
 await assert.rejects(quota.fresh(),/QuotaExceededError|初代の保存を中断/);
 assert.equal(quota.data.images.size,0);
 assert.equal(quota.data.meta.size,0,'atomically roll back all staged images and DNA');

 const parallel=fixture();
 const double=await Promise.allSettled([parallel.fresh(),parallel.fresh()]);
 assert.equal(double.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(double.filter(x=>x.status==='rejected').length,1);
 assert.equal(parallel.data.images.size,60);
 assert.equal(parallel.data.meta.get('current_generation_id'),'gen00001');

 const warning=fixture({warning:true});
 for(let i=1;i<=60;i++){
   warning.data.images.set(warning.imageKey(i),new Blob(['white']));
   warning.data.meta.set(warning.genomeKey(i),{schema_version:1,lineage:i<=30?'poison':'harmless'});
 }
 warning.data.meta.set('founder_generation_identity',warning.marker);
 warning.data.meta.set('warning_neutral_run_seed_v1','0123456789abcdef0123456789abcdef');
 await warning.recover();
 assert.equal(warning.data.meta.get('current_generation_id'),'gen00001');
 assert.ok(warning.data.meta.has('warning_neutral_run_seed_v1'));
 console.log('RE2-EV-01: atomic fresh gen1, full legacy repair, incomplete/later data refusal, quota rollback, 2-tab CAS, warning seed OK.');
})().catch(error=>{console.error(error);process.exitCode=1;});
