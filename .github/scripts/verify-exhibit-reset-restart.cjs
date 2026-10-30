'use strict';
// Execute the shipped administrator reset, founder checkpoint and normal
// generation commit against ONE synthetic IndexedDB. This is never an iPad
// acceptance test and never opens the user's production database.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const admin=fs.readFileSync('exhibit/admin.js','utf8');
const engine=fs.readFileSync('js/pages_preview.js','utf8');
function extract(text,begin,end) {
 const a=text.indexOf(begin),b=text.indexOf(end,a);
 assert.ok(a>=0&&b>a,'cannot extract shipped code '+begin);
 return text.slice(a,b);
}
const resetCode=extract(admin,'  // EXH-RESET-BEGIN:','  // EXH-RESET-END.');
const founderCode=extract(engine,'  async function commitFounderCheckpoint(',
 '  async function ensureFounderGeneration(');
const evolutionCode=extract(engine,'  async function commitEvolutionGeneration(',
 '  async function idbEntriesByPrefix(');
const STORES=['images','meta','theater_frames'];
const MODES={
 cryptic:{label:'隠れるギタイ',db:'synthetic-cryptic'},
 warning:{label:'目立つギタイ',db:'synthetic-warning'}
};
function setup() {
 const data=Object.fromEntries(Object.keys(MODES).map(mode=>[
   mode,Object.fromEntries(STORES.map(s=>[s,new Map()]))
 ]));
 const dbs={};
 for(const mode of Object.keys(MODES)){
  const state=data[mode],work=[];
  let busy=false;
  function next(){
   if(busy||!work.length)return;
   busy=true;const tx=work.shift();
   const draft=Object.fromEntries(STORES.map(s=>[s,new Map(state[s])]));
   let aborted=false,scheduled=false;
   function pump(){
    if(aborted||scheduled)return;
    scheduled=true;queueMicrotask(()=>{
     scheduled=false;if(aborted)return;
     const op=tx.queue.shift();
     if(!op){
      for(const s of STORES)state[s]=draft[s];
      busy=false;tx.oncomplete?.();next();return;
     }
     try {
      const map=draft[op.store];
      if(op.kind==='get')op.req.result=map.get(op.key);
      if(op.kind==='count')op.req.result=map.size;
      if(op.kind==='keys')op.req.result=[...map.keys()];
      if(op.kind==='clear')map.clear();
      if(op.kind==='put')map.set(op.key,op.value);
      if(op.kind==='delete')map.delete(op.key);
      op.req?.onsuccess?.();pump();
     } catch(e){tx.error=e;tx.abort();}
    });
   }
   tx.queue=[];
   tx.abort=()=>{
    if(aborted)return;
    aborted=true;busy=false;queueMicrotask(()=>{tx.onabort?.();next();});
   };
   tx.objectStore=name=>{
    assert.ok(STORES.includes(name));
    function op(kind,key,value){
     const req={result:undefined,onsuccess:null,onerror:null};
     tx.queue.push({kind,store:name,key,value,req});pump();return req;
    }
    return {
     get:key=>op('get',key),
     count:()=>op('count'),
     getAllKeys:()=>op('keys'),
     clear:()=>{assert.equal(tx.mode,'readwrite');op('clear');},
     put:(value,key)=>{assert.equal(tx.mode,'readwrite');op('put',key,value);},
     delete:key=>{assert.equal(tx.mode,'readwrite');op('delete',key)}
    };
   };
   pump();
  }
  dbs[mode]={
   close(){},
   transaction(names,kind){
    if(typeof names==='string')names=[names];
    assert.ok(names.every(s=>STORES.includes(s)));
    assert.ok(['readonly','readwrite'].includes(kind));
    const tx={mode:kind,oncomplete:null,onabort:null,onerror:null,error:null};
    work.push(tx);next();return tx;
   }
  };
 }
 // State intentionally contains a previous-generation run and a different
 // exhibition mode. The admin reset must not touch unrelated namespaces.
 for(const mode of Object.keys(MODES)){
  const state=data[mode];
  state.images.set('gen00018:01',new Blob(['old image']));
  state.meta.set('current_generation_id','gen00018');
  state.meta.set('genome:gen00018:01',{old:true});
  state.meta.set('restore_epoch','original-'+mode);
  state.theater_frames.set('gen00018-frame',{old:true});
 }
 const lifeKey='gitai-warning-life-v1:'+MODES.warning.db;
 const durableKeys=Object.fromEntries(Object.keys(MODES).map(m=>[
   m,'gitai-exhibit-visit-start-durable-v1:'+MODES[m].db
 ]));
 const pendingKeys=Object.fromEntries(Object.keys(MODES).map(m=>[
   m,'gitai-exhibit-handover-pending-durable-v1:'+MODES[m].db
 ]));
 const local=new Map([[lifeKey,JSON.stringify({generation_id:'gen00018',thirds:9})],
                      ...Object.keys(MODES).map(m=>[pendingKeys[m],'pending-'+m]),
                      ['admin-passcode','keep'],
                      ...Object.keys(MODES).map(m=>[durableKeys[m],JSON.stringify({
                        mode:m,namespace:MODES[m].db,start:16
                      })])]);
 const sessions=new Map([
  ['gitai-exhibit-visit-start-v1',JSON.stringify({mode:'warning',start:17})],
  ['gitai-exhibit-handover-v1',JSON.stringify({mode:'warning',start:16,end:17})],
  ['gitai-exhibit-handover-pending-v1',
   JSON.stringify({mode:'warning',start:17,end:18})]
 ]);
 const caches=new Map([['offline-app-cache','unchanged']]);
 const adminCtx={
  MODES,STORES,Error,Uint8Array,
  openDb:name=>Promise.resolve(dbs[Object.keys(MODES).find(m=>MODES[m].db===name)]),
  crypto:{getRandomValues:a=>{a.fill(7);return a;}},
  warningLifeStorageKey:name=>'gitai-warning-life-v1:'+name,
  localStorage:{getItem:k=>local.get(k)??null,removeItem:k=>local.delete(k)},
  sessionStorage:{getItem:k=>sessions.get(k)??null,removeItem:k=>sessions.delete(k)}
 };
 vm.runInNewContext(resetCode+'\nglobalThis.api={inspectModeBeforeReset,resetModeForExhibit};',
   adminCtx,{timeout:5000});
 function engineFor(mode,epoch){
  const ctx={
   Error,Blob,TOTAL:60,loadedRestoreEpoch:epoch,restoreEpochCaptured:true,
   WARNING_EXPERIMENT:mode==='warning',
   IMAGE_STORE:'images',META_STORE:'meta',THEATER_STORE:'theater_frames',
   openDb:async()=>dbs[mode],
   imageKey:(g,i)=>g+':'+String(i).padStart(2,'0'),
   genomeKey:(g,i)=>'genome:'+g+':'+String(i).padStart(2,'0')
  };
  vm.runInNewContext(founderCode+evolutionCode+
    '\nglobalThis.api={commitFounderCheckpoint,commitEvolutionGeneration};',
    ctx,{timeout:5000});
  return ctx.api;
 }
 function sixty(type){
  return new Map(Array.from({length:60},(_,j)=>[
   j+1,type==='image'
    ?new Blob(['image-'+(j+1)],{type:'image/png'})
    :{schema_version:1,individual:j+1}
  ]));
 }
 return {data,local,sessions,caches,lifeKey,durableKeys,pendingKeys,
   admin:adminCtx.api,engineFor,sixty};
}
(async()=>{
 for(const mode of ['cryptic','warning']){
  const f=setup(),other=mode==='warning'?'cryptic':'warning';
  const originalOther={
   pointer:f.data[other].meta.get('current_generation_id'),
   image:f.data[other].images.get('gen00018:01'),
   epoch:f.data[other].meta.get('restore_epoch')
  };
  const before=await f.admin.inspectModeBeforeReset(mode);
  assert.equal(before.generation,'gen00018');
  assert.equal(before.counts.images,1);
  assert.equal(before.counts.meta,3);
  assert.equal(before.counts.theater_frames,1);
  assert.equal((await f.admin.resetModeForExhibit(mode,before)).status,'complete');
  const state=f.data[mode];
  assert.equal(state.images.size,0);
  assert.equal(state.theater_frames.size,0);
  assert.equal(state.meta.size,1);
  const epoch=state.meta.get('restore_epoch');
  assert.match(epoch,/^exhibit-reset-[a-f0-9]{32}$/);
  assert.equal(f.data[other].meta.get('current_generation_id'),originalOther.pointer);
  assert.equal(f.data[other].images.get('gen00018:01'),originalOther.image);
  assert.equal(f.data[other].meta.get('restore_epoch'),originalOther.epoch);
  assert.equal(f.local.get('admin-passcode'),'keep');
  assert.equal(f.local.has(f.durableKeys[mode]),false,
    'selected experiment loses its old five-generation counter');
  assert.equal(f.local.has(f.durableKeys[other]),true,
    'unrelated experiment keeps its visitor counter');
  assert.equal(f.local.has(f.pendingKeys[mode]),false,
    'reset removes only selected experiment\'s crash-recovery intent');
  assert.equal(f.local.has(f.pendingKeys[other]),true,
    'other experiment pending recovery is unaffected');
  assert.equal(f.caches.get('offline-app-cache'),'unchanged');
  if(mode==='warning'){
   assert.equal(f.local.has(f.lifeKey),false);
   assert.equal(f.sessions.size,0,'all warning handover markers cleared');
  } else {
   assert.ok(f.local.has(f.lifeKey));
   assert.equal(f.sessions.size,3,'cryptic reset leaves warning visitor alone');
  }
  const engine=f.engineFor(mode,epoch);
  const marker='continuous_v1:standard_white_001:standard_white_001';
  const prepared={blobs:f.sixty('image'),genomes:f.sixty('genome')};
  await engine.commitFounderCheckpoint('founder_generation_identity',marker,prepared);
  assert.equal(state.meta.get('current_generation_id'),'gen00001');
  assert.equal(state.images.size,60);
  assert.equal(state.meta.size,63,'60 DNA + pointer + identity + reset epoch');
  assert.equal(state.meta.get('restore_epoch'),epoch);
  for(let i=1;i<=60;i++){
   assert.ok(state.images.has('gen00001:'+String(i).padStart(2,'0')));
   assert.ok(state.meta.has('genome:gen00001:'+String(i).padStart(2,'0')));
  }
  await engine.commitEvolutionGeneration('gen00001','gen00002',
    f.sixty('image'),f.sixty('genome'));
  assert.equal(state.meta.get('current_generation_id'),'gen00002');
  assert.equal(state.meta.get('restore_epoch'),epoch);
  assert.equal(state.images.size,120);
  const reopened=f.engineFor(mode,epoch);
  // A second normal generation after simulated reload proves the restored
  // epoch is retained and the new run is writable without reinitializing.
  await reopened.commitEvolutionGeneration('gen00002','gen00003',
    f.sixty('image'),f.sixty('genome'));
  assert.equal(state.meta.get('current_generation_id'),'gen00003');
  assert.equal(state.images.size,120,'previous generation deleted atomically');
  const oldTab=f.engineFor(mode,'original-'+mode);
  await assert.rejects(oldTab.commitEvolutionGeneration('gen00003','gen00004',
    f.sixty('image'),f.sixty('genome')),/復元|変更/);
  assert.equal(state.meta.get('current_generation_id'),'gen00003');
  assert.equal(f.data[other].meta.get('current_generation_id'),originalOther.pointer);
 }
 console.log('EXH-RESET-INTEGRATION: shipped admin reset -> 60 founders -> 2 atomic evolutions -> reload -> old-tab fence; both modes isolated, life/PIN/cache preserved.');
})().catch(e=>{console.error(e);process.exitCode=1;});
