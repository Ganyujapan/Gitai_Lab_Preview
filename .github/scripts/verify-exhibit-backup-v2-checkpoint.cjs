'use strict';
// RE2-EXH-02: exercise checkpoint against an isolated event/transaction
// simulator. NEVER open real IndexedDB or touch exhibition player data.
const assert=require('node:assert/strict');
const {makeCheckpoint,readCheckpoint,listCheckpointIds,inspectCheckpoint,discardCheckpoint,STAGE_STORE,SOURCE_STORES}=
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
function fakeDb({withStage=true,quotaAt=Infinity,cleanupAbortAt=Infinity}={}) {
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
  let activeTx=0,putCount=0,deleteCount=0,keyCursorVisited=0;
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
                  enqueue(()=>{
                    if(++deleteCount===cleanupAbortAt)
                      throw Error('AbortError: simulated cleanup interruption');
                    stage[name].delete(item.serialized);
                  });
                }
              }:null;
              req.onsuccess?.();
            }
            enqueue(next);
            return req;
          },
          openKeyCursor(){
            assert.equal(name,STAGE_STORE,'key-only discovery: stage only');
            const keys=entriesOf(stage[name]).map(x=>x.key).sort(compareKey);
            const req={result:null,error:null,onsuccess:null,onerror:null};
            let at=0;
            function deliver(){
              const key=keys[at++];
              req.result=key===undefined?null:{
                key:cloneValue(key),
                continue(target){
                  enqueue(()=>{
                    while(at<keys.length&&compareKey(keys[at],target)<0)at++;
                    deliver();
                  });
                }
              };
              if(key!==undefined)keyCursorVisited++;
              req.onsuccess?.();
            }
            enqueue(deliver);
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
    getActive(){return activeTx},
    getKeyCursorVisited(){return keyCursorVisited}
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
  assert.deepEqual(await listCheckpointIds(f.db),[]);
  assert.throws(()=>listCheckpointIds(legacy.db),/未準備/);
  assert.throws(()=>listCheckpointIds(f.db,{maxIds:65}),/上限|指定/);
  // Simulate a competing generation commit blocked until checkpoint completes.
  f.mutateAfterCheckpoint(data=>{
    data.meta.set('current_generation_id','gen00043');
    data.images.set('gen00043:01',new Blob(['new generation']));
    data.meta.set('genome:gen00043:01',{schema_version:1,baseHue:9});
  });
  const cp=await makeCheckpoint(f.db,ID);
  assert.equal(cp.generation,GEN);
  assert.equal(cp.entries,123);
  assert.match(cp.checkpointToken,/^[0-9a-f]{32}$/);
  assert.equal(f.data.meta.get('current_generation_id'),'gen00043');
  assert.equal(f.getStage(ID),123);
  const beforeDiscovery=f.log.length;
  assert.deepEqual(await listCheckpointIds(f.db),[ID]);
  assert.equal(f.getKeyCursorVisited(),1);
  assert.equal(f.log.length,beforeDiscovery+1);
  assert.deepEqual(f.log.at(-1).names,[STAGE_STORE]);
  assert.equal(f.log.at(-1).mode,'readonly');
  // After an app restart the caller may have lost cp.checkpointToken.
  // A read-only inventory of a KNOWN ID recovers the exact token, without
  // reading values into a report or touching the original evolution stores.
  const beforeInspection=f.log.length;
  const inventory=await inspectCheckpoint(f.db,ID);
  assert.deepEqual(inventory,{
    snapshotId:ID,checkpointToken:cp.checkpointToken,entries:cp.entries,
    byStore:{images:60,meta:62,theater_frames:1},generation:GEN
  });
  assert.equal(f.log.length,beforeInspection+1);
  assert.deepEqual(f.log.at(-1).names,[STAGE_STORE]);
  assert.equal(f.log.at(-1).mode,'readonly');
  assert.equal(f.getStage(ID),123);
  assert.equal(f.data.meta.get('current_generation_id'),'gen00043');
  assert.equal(await inspectCheckpoint(f.db,OTHER),null);
  assert.deepEqual(f.log[0].names,[...SOURCE_STORES,STAGE_STORE]);
  assert.equal(f.log[0].mode,'readwrite');
  await assert.rejects(makeCheckpoint(f.db,ID),/上書きしません/);
  assert.equal(f.getStage(ID),123);

  // Byte conversion is async, but the single full-source transaction is
  // already finished; staged state remains immutable across many short reads.
  const files=[];
  const saved=await writePartsFromRecords(
    readCheckpoint(f.db,ID,cp.entries,
      {batchSize:7,checkpointToken:cp.checkpointToken}),
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
    for await(const x of readCheckpoint(f.db,ID,cp.entries+1,
      {checkpointToken:cp.checkpointToken}))void x;
  })(),/不足/);

  // Cooperative cancellation leaves the committed checkpoint and all
  // original records untouched; no new read transaction starts if aborted.
  const alreadyCancelled=new AbortController();
  alreadyCancelled.abort();
  const txBeforeCancel=f.log.length;
  await assert.rejects((async()=>{
    for await(const item of readCheckpoint(f.db,ID,cp.entries,
      {batchSize:7,signal:alreadyCancelled.signal,
        checkpointToken:cp.checkpointToken})) void item;
  })(),/中断/);
  assert.equal(f.log.length,txBeforeCancel,
    'pre-cancelled checkpoint read must not start an IDB transaction');

  const cancelMidRead=new AbortController();
  const iter=readCheckpoint(f.db,ID,cp.entries,
    {batchSize:7,signal:cancelMidRead.signal,
      checkpointToken:cp.checkpointToken});
  const firstRow=await iter.next();
  assert.equal(firstRow.done,false);
  const afterFirstRow=f.log.length;
  cancelMidRead.abort();
  await assert.rejects(iter.next(),/中断/);
  assert.equal(f.log.length,afterFirstRow,
    'abort must stop reading before the next batch');
  assert.equal(f.getStage(ID),cp.entries);
  assert.equal(f.getActive(),0);
  assert.deepEqual(f.data.meta.get('current_generation_id'),'gen00043');

  await assert.rejects((async()=>{
    for await(const item of readCheckpoint(f.db,ID,cp.entries,
      {signal:{aborted:'invalid'},
        checkpointToken:cp.checkpointToken})) void item;
  })(),/中断通知/);

  // The caller must pass the random token from makeCheckpoint, never just
  // the reusable human-readable snapshot ID and total row count.
  await assert.rejects((async()=>{
    for await(const x of readCheckpoint(f.db,ID,cp.entries))void x;
  })(),/一時保存識別子/);

  // A competing tab may clean up A and start B under the same snapshot ID.
  // The row count and keys can be IDENTICAL, but the old reader must refuse
  // to blend rows from A and B into one successful manifest.
  const race=fakeDb();
  const old=await makeCheckpoint(race.db,ID);
  const oldReader=readCheckpoint(race.db,ID,old.entries,
    {batchSize:3,checkpointToken:old.checkpointToken});
  assert.equal((await oldReader.next()).done,false);
  const removedOld=await discardCheckpoint(race.db,ID,old.checkpointToken);
  assert.equal(removedOld,old.entries);
  const replacement=await makeCheckpoint(race.db,ID);
  assert.equal(replacement.entries,old.entries);
  assert.notEqual(replacement.checkpointToken,old.checkpointToken);
  // An old tab's cleanup arriving after ID reuse must not erase B.
  await assert.rejects(discardCheckpoint(race.db,ID,old.checkpointToken),
    /別のスナップショット/);
  assert.equal(race.getStage(ID),replacement.entries);
  assert.throws(()=>discardCheckpoint(race.db,ID),/一時保存識別子/);
  assert.equal(race.getStage(ID),replacement.entries);
  await assert.rejects((async()=>{
    for(;;) {
      if((await oldReader.next()).done)break;
    }
  })(),/別のスナップショット/);
  assert.equal(race.getStage(ID),replacement.entries);
  let freshCount=0;
  for await(const x of readCheckpoint(race.db,ID,replacement.entries,
    {batchSize:3,checkpointToken:replacement.checkpointToken}))freshCount++;
  assert.equal(freshCount,replacement.entries);
  assert.equal(race.getActive(),0);
  assert.equal(race.data.meta.get('current_generation_id'),GEN);

  // A different tab can remove rows that were ALREADY yielded. Comparing
  // only the yielded count misses this mutation: the final total count
  // must be rechecked before the writer can return a complete manifest.
  const lost=fakeDb();
  const initial=await makeCheckpoint(lost.db,ID);
  const lostReader=readCheckpoint(lost.db,ID,initial.entries,
    {batchSize:2,checkpointToken:initial.checkpointToken});
  assert.equal((await lostReader.next()).done,false);
  const dropped=lost.data[STAGE_STORE].delete(JSON.stringify(
    [ID,'images',GEN+':01']));
  assert.equal(dropped,true);
  let lostReadCount=1;
  await assert.rejects((async()=>{
    for(;;) {
      const next=await lostReader.next();
      if(next.done)break;
      lostReadCount++;
    }
  })(),/読込み中に変更|不足/);
  assert.equal(lostReadCount,initial.entries,
    'all rows were read, so ONLY the final stage count finds prior removal');
  assert.equal(lost.getStage(ID),initial.entries-1);
  assert.equal(lost.getActive(),0);
  assert.equal(lost.data.meta.get('current_generation_id'),GEN);

  // Snapshot A and B coexist; cancelling A deletes ONLY A's temporary keys.
  f.data.meta.set('current_generation_id',GEN);
  const cp2=await makeCheckpoint(f.db,OTHER);
  assert.equal(cp2.entries,125); // the 2 newly added gen43 records remain.
  const removed=await discardCheckpoint(f.db,ID,cp.checkpointToken);
  assert.equal(removed,cp.entries);
  assert.equal(f.getStage(ID),0);
  assert.equal(await inspectCheckpoint(f.db,ID),null);
  assert.equal(f.getStage(OTHER),cp2.entries);
  assert.equal(f.data.meta.get('current_generation_id'),GEN);
  await assert.rejects((async()=>{
    for await(const x of readCheckpoint(f.db,ID,cp.entries,
      {checkpointToken:cp.checkpointToken}))void x;
  })(),/不足/);

  // Corrupt one row near the END of a checkpoint. The cursor may have
  // queued many deletes, but a mismatched token must abort the entire
  // cleanup transaction and preserve all 123 staged records.
  const mixed=fakeDb();
  const owned=await makeCheckpoint(mixed.db,ID);
  const frames=[...mixed.data[STAGE_STORE].values()]
    .find(x=>x.__key[1]==='theater_frames');
  assert.ok(frames);
  frames.value.checkpointToken='f'.repeat(32)===owned.checkpointToken ?
    'e'.repeat(32) : 'f'.repeat(32);
  await assert.rejects(inspectCheckpoint(mixed.db,ID),/異なる一時保存/);
  assert.equal(mixed.getStage(ID),owned.entries);
  await assert.rejects(discardCheckpoint(mixed.db,ID,owned.checkpointToken),
    /別のスナップショット/);
  assert.equal(mixed.getStage(ID),owned.entries,
    'rollback must undo earlier cursor deletes on token mismatch');
  assert.equal(mixed.getActive(),0);
  assert.equal(mixed.data.images.size,60);
  assert.equal(mixed.data.meta.size,62);
  assert.equal(mixed.data.theater_frames.size,1);
  assert.equal(mixed.data.meta.get('current_generation_id'),GEN);
  frames.value.checkpointToken=owned.checkpointToken;
  assert.equal(await discardCheckpoint(mixed.db,ID,owned.checkpointToken),
    owned.entries);
  assert.equal(mixed.getStage(ID),0);

  // A crash can lose the in-memory checkpoint token, while the committed
  // stage remains after restart. Inspection must recover the token for an
  // explicit owner-confirmed cleanup; NEVER delete on inspection alone.
  const orphan=fakeDb();
  await makeCheckpoint(orphan.db,ID); // deliberately discard the return
  const recovered=await inspectCheckpoint(orphan.db,ID);
  assert.equal(recovered.entries,123);
  assert.equal(orphan.getStage(ID),123);
  assert.equal(await discardCheckpoint(orphan.db,ID,recovered.checkpointToken),
    recovered.entries);
  assert.equal(orphan.getStage(ID),0);
  assert.equal(orphan.data.images.size,60);
  assert.equal(orphan.data.meta.size,62);
  assert.equal(orphan.data.theater_frames.size,1);

  // Simulate cleanup itself failing after some cursor deletes. IndexedDB
  // must roll back ALL staged deletions, and an explicit retry must succeed.
  const cleanupFail=fakeDb({cleanupAbortAt:17});
  const cleanupSource=await makeCheckpoint(cleanupFail.db,ID);
  await assert.rejects(
    discardCheckpoint(cleanupFail.db,ID,cleanupSource.checkpointToken),
    /simulated cleanup interruption/);
  assert.equal(cleanupFail.getStage(ID),cleanupSource.entries);
  assert.equal(cleanupFail.getActive(),0);
  const afterAbort=await inspectCheckpoint(cleanupFail.db,ID);
  assert.equal(afterAbort.checkpointToken,cleanupSource.checkpointToken);
  assert.equal(afterAbort.entries,cleanupSource.entries);
  assert.equal(await discardCheckpoint(cleanupFail.db,ID,
    cleanupSource.checkpointToken),cleanupSource.entries);
  assert.equal(cleanupFail.getStage(ID),0);
  assert.equal(cleanupFail.data.images.size,60);
  assert.equal(cleanupFail.data.meta.size,62);
  assert.equal(cleanupFail.data.theater_frames.size,1);
  assert.equal(cleanupFail.data.meta.get('current_generation_id'),GEN);

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
  await discardCheckpoint(f.db,OTHER,cp2.checkpointToken);
  assert.equal(f.data.images.size,61);
  assert.equal(f.data.meta.size,63);
  assert.equal(f.data.theater_frames.size,1);
  assert.equal(f.getStage(OTHER),0);
  console.log('RE2-EXH-02 checkpoint: single atomic four-store capture, queued evolution, staged 123-record v2 round-trip, batch reads, collision/quota/cleanup rollback OK.');
})().catch(error=>{console.error(error);process.exitCode=1;});
