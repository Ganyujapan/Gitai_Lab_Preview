'use strict';
// RE2-EXH-02: exercise checkpoint against an isolated event/transaction
// simulator. NEVER open real IndexedDB or touch exhibition player data.
const assert=require('node:assert/strict');
const {makeCheckpoint,readCheckpoint,discardCheckpoint,STAGE_STORE,SOURCE_STORES}=
  require('../../exhibit/backup_checkpoint_v2.js');
const {writePartsFromRecords,verifyPartIntegrity}=require('../../exhibit/backup_v2.js');
const {webcrypto}=require('node:crypto');
const GEN='gen00042', ID='checkpoint-20261027-a1', OTHER='checkpoint-20261027-b2';
const DBNAME='checkpoint-fixture';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
if(!globalThis.File)globalThis.File=class extends Blob {
  constructor(parts,name,opts){super(parts,opts);this.name=name;}
};

function compareKey(a,b){
  const rank=v=>typeof v==='number'?0:typeof v==='string'?1:Array.isArray(v)?2:3;
  if(rank(a)!==rank(b))return rank(a)-rank(b);
  if(Array.isArray(a)&&Array.isArray(b)){
    for(let i=0;i<Math.min(a.length,b.length);i++){
      const cmp=compareKey(a[i],b[i]);if(cmp)return cmp;
    }
    return a.length-b.length;
  }
  return a<b?-1:a>b?1:0;
}
const inRange=(k,r)=>!r||(
  (compareKey(k,r.lower)>0||(!r.lowerOpen&&compareKey(k,r.lower)===0))&&
  (compareKey(k,r.upper)<0||(!r.upperOpen&&compareKey(k,r.upper)===0)));
globalThis.IDBKeyRange={
  bound(lower,upper,lowerOpen=false,upperOpen=false) {
    return {lower,upper,lowerOpen,upperOpen};
  }
};
const cloneValue=v=>structuredClone(v);
function fakeDb({withStage=true,quotaAt=Infinity}={}) {
  const source={
    images:new Map(),meta:new Map([['current_generation_id',GEN]]),
    theater_frames:new Map([['frame:'+GEN,{markers:[1,2]}]])
  };
  for(let i=1;i<=60;i++){
    const id=String(i).padStart(2,'0');
    source.images.set(GEN+':'+id,new Blob(['PNG'+id],{type:'image/png'}));
    source.meta.set('genome:'+GEN+':'+id,
      {schema_version:1,baseHue:i,modules:{central_blotch:{alleles:[1,0]}}});
  }
  // IndexedDB accepts numeric keys and stores data as structured clones.
  source.meta.set(17,{unusual:'numeric key'});
  const initialEntries=()=>({
    images:new Map([...source.images].map(([k,v])=>[k,cloneValue(v)])),
    meta:new Map([...source.meta].map(([k,v])=>[k,cloneValue(v)])),
    theater_frames:new Map([...source.theater_frames].map(([k,v])=>[k,cloneValue(v)])),
    ...(withStage?{[STAGE_STORE]:new Map()}: {})
  });
  const data=initialEntries();
  let activeTx=0,putCount=0;
  const log=[];
  let concurrent=null;
  function mutateAfterCheckpoint(fn){concurrent=fn}
  function entriesOf(map){
    return [...map.entries()].map(([serialized,item])=>{
      if(map===undefined)return null;
      // Stage uses JSON-serialized array keys to model compound IDB keys.
      return Array.isArray(item?.__key) ?
        {key:item.__key,value:item.value,serialized}:
        {key:serialized,value:item,serialized};
    });
  }
  function transaction(stores,mode){
    const names=typeof stores==='string'?[stores]:[...stores];
    if(names.some(n=>!data[n]))throw Error('NotFoundError');
    activeTx++;
    log.push({names,mode});
    const stage=Object.fromEntries(names.map(n=>[n,new Map(data[n])]));
    let aborted=false,committed=false,ops=[],scheduled=false;
    const tx={error:null,oncomplete:null,onabort:null,onerror:null,
      abort(){abort(Error('AbortError'))},
      objectStore(name) {
        if(!names.includes(name))throw Error('StoreNotInScope');
        return {
          get(key) {return request(()=>cloneValue(stage[name].get(key)))},
          count(range) {
            return request(()=>[...stage[name].values()].filter(item=>
              inRange(item.__key,range)).length);
          },
          put(value,key){
            if(mode!=='readwrite')throw Error('ReadOnlyError');
            enqueue(()=>{
              if(++putCount===quotaAt)throw Error('QuotaExceededError');
              if(name===STAGE_STORE)stage[name].set(JSON.stringify(key),
                {__key:cloneValue(key),value:cloneValue(value)});
              else stage[name].set(key,cloneValue(value));
            });
          },
          openCursor(range) {
            const rows=name===STAGE_STORE?
              entriesOf(stage[name]).filter(x=>inRange(x.key,range))
                .sort((a,b)=>compareKey(a.key,b.key)):
              [...stage[name].entries()].filter(([key])=>inRange(key,range))
                .map(([key,value])=>({key,value,serialized:key}))
                .sort((a,b)=>compareKey(a.key,b.key));
            const req={result:null,error:null,onsuccess:null,onerror:null};
            let at=0;
            function next() {
              const item=rows[at++];
              req.result=item?{
                key:cloneValue(item.key),value:cloneValue(item.value),
                continue(){enqueue(next)},
                delete(){
                  if(mode!=='readwrite')throw Error('ReadOnlyError');
                  enqueue(()=>stage[name].delete(item.serialized));
                }
              }:null;
              req.onsuccess?.();
            }
            enqueue(next);
            return req;
          }
        }
      }
    };
    function abort(error){
      if(aborted||committed)return;
      aborted=true;tx.error=error;
      ops.length=0;
      setImmediate(()=>{activeTx--;tx.onabort?.()});
    }
    function enqueue(operation){
      if(aborted||committed)throw Error('TransactionInactiveError');
      ops.push(operation);
      if(!scheduled){scheduled=true;setImmediate(pump);}
    }
    function pump(){
      scheduled=false;
      if(aborted||committed)return;
      const operation=ops.shift();
      if(operation){
        try{operation()}catch(error){abort(error);return;}
        scheduled=true;setImmediate(pump);
      }else{
        committed=true;
        if(mode==='readwrite'){
          for(const name of names)data[name]=stage[name];
        }
        activeTx--;
        if(names.includes(STAGE_STORE)&&names.length===4&&concurrent){
          const apply=concurrent;concurrent=null;apply(data);
        }
        tx.oncomplete?.();
      }
    }
    function request(produce) {
      const req={result:null,error:null,onsuccess:null,onerror:null};
      enqueue(()=>{req.result=produce();req.onsuccess?.()});
      return req;
    }
    return tx;
  }
  return {
    data,log,mutateAfterCheckpoint,
    db:{objectStoreNames:{contains:name=>!!data[name]},transaction},
    getStage(id){return [...data[STAGE_STORE]?.values()||[]]
      .filter(x=>x.__key[0]===id).length},
    getActive(){return activeTx}
  };
}
(async()=>{
  let f=fakeDb();
  // Creation requires a deliberately provisioned stage store: no implicit DB
  // upgrade, no accidental copy into an actual version-2 exhibition database.
  const legacy=fakeDb({withStage:false});
  assert.throws(()=>makeCheckpoint(legacy.db,ID),/未準備/);
  assert.deepEqual(legacy.data.meta.get('current_generation_id'),GEN);
  assert.throws(()=>makeCheckpoint(f.db,'../unsafe'),/識別子/);
  assert.equal(f.getStage(ID),0);
  // Simulate a competing generation commit blocked until checkpoint completes.
  f.mutateAfterCheckpoint(data=>{
    data.meta.set('current_generation_id','gen00043');
    data.images.set('gen00043:01',new Blob(['new generation']));
    data.meta.set('genome:gen00043:01',{schema_version:1,baseHue:9});
  });
  const cp=await makeCheckpoint(f.db,ID);
  assert.equal(cp.generation,GEN);
  assert.equal(cp.entries,123);
  assert.equal(f.data.meta.get('current_generation_id'),'gen00043');
  assert.equal(f.getStage(ID),123);
  assert.deepEqual(f.log[0].names,[...SOURCE_STORES,STAGE_STORE]);
  assert.equal(f.log[0].mode,'readwrite');
  await assert.rejects(makeCheckpoint(f.db,ID),/上書きしません/);
  assert.equal(f.getStage(ID),123);

  // Byte conversion is async, but the single full-source transaction is
  // already finished; staged state remains immutable across many short reads.
  const files=[];
  const saved=await writePartsFromRecords(
    readCheckpoint(f.db,ID,cp.entries,{batchSize:7}),
    {mode:'cryptic',database:DBNAME,currentGeneration:GEN,maxPartBytes:2000,maxPartEntries:13},
    async file=>{files.push(file)}
  );
  const ok=await verifyPartIntegrity(saved.manifestFile,files,'cryptic',DBNAME);
  assert.equal(ok.entries,123);
  assert.equal(ok.generation,GEN);
  assert.ok(f.log.filter(t=>t.names.length===1&&t.mode==='readonly').length>4);
  assert.equal(f.getActive(),0);
  assert.equal(f.data.meta.get('current_generation_id'),'gen00043');
  // A truncated/externally lost checkpoint must never look complete.
  await assert.rejects((async()=>{
    for await(const x of readCheckpoint(f.db,ID,cp.entries+1))void x;
  })(),/不足/);

  // Snapshot A and B coexist; cancelling A deletes ONLY A's temporary keys.
  f.data.meta.set('current_generation_id',GEN);
  const cp2=await makeCheckpoint(f.db,OTHER);
  assert.equal(cp2.entries,125); // the 2 newly added gen43 records remain.
  const removed=await discardCheckpoint(f.db,ID);
  assert.equal(removed,cp.entries);
  assert.equal(f.getStage(ID),0);
  assert.equal(f.getStage(OTHER),cp2.entries);
  assert.equal(f.data.meta.get('current_generation_id'),GEN);
  await assert.rejects((async()=>{
    for await(const x of readCheckpoint(f.db,ID,cp.entries))void x;
  })(),/不足/);

  // Quota error must roll back 100% of temporary stage without modifying
  // images, meta, frames or previous (different ID) snapshots.
  const quota=fakeDb({quotaAt:17});
  const priorImages=quota.data.images.size,priorGenome=quota.data.meta.size;
  await assert.rejects(makeCheckpoint(quota.db,ID),/QuotaExceededError/);
  assert.equal(quota.getStage(ID),0);
  assert.equal(quota.data.images.size,priorImages);
  assert.equal(quota.data.meta.size,priorGenome);
  assert.equal(quota.data.meta.get('current_generation_id'),GEN);
  const missing=fakeDb();
  missing.data.meta.delete('current_generation_id');
  await assert.rejects(makeCheckpoint(missing.db,ID),/世代番号/);
  assert.equal(missing.getStage(ID),0);

  // Explicit cleanup never erases a single original record.
  await discardCheckpoint(f.db,OTHER);
  assert.equal(f.data.images.size,61);
  assert.equal(f.data.meta.size,63);
  assert.equal(f.data.theater_frames.size,1);
  assert.equal(f.getStage(OTHER),0);
  console.log('RE2-EXH-02 checkpoint: single atomic four-store capture, queued evolution, staged 123-record v2 round-trip, batch reads, collision/quota/cleanup rollback OK.');
})().catch(error=>{console.error(error);process.exitCode=1;});
