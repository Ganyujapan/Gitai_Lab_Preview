'use strict';
// RE2-EXH-02: test real isolated atomic restore functions on a transactional
// event model. Never connects to a user's IndexedDB or exhibits live game.
const assert=require('node:assert/strict');
const {writePartsFromRecords,verifyPartIntegrity,validateManifest,MAX_MANIFEST_BYTES}=
  require('../../exhibit/backup_v2.js');
const semantic=require('../../exhibit/backup_restore_preflight_v2.js');
const restore=require('../../exhibit/backup_restore_atomic_v2.js');
if(typeof File==='undefined')globalThis.File=class extends Blob{
  constructor(parts,name,opts){super(parts,opts);this.name=name;}
};
const DB='gitai-backup-rehearsal-'+ 'a'.repeat(32);
const GEN='gen00035',OLD='gen00022';
const stageId='restore-'+ 'b'.repeat(32);
const id=i=>String(i).padStart(2,'0');
const clone=v=>structuredClone(v);
function cmp(a,b){
  const rank=x=>typeof x==='number'?0:typeof x==='string'?1:Array.isArray(x)?2:3;
  if(rank(a)!==rank(b))return rank(a)-rank(b);
  if(Array.isArray(a)){
    for(let i=0;i<Math.min(a.length,b.length);i++){
      const c=cmp(a[i],b[i]);if(c)return c;
    }return a.length-b.length;
  }
  return a<b?-1:a>b?1:0;
}
const inside=(key,range)=>!range||
  (cmp(key,range.lower)>0||(!range.lowerOpen&&cmp(key,range.lower)===0))&&
  (cmp(key,range.upper)<0||(!range.upperOpen&&cmp(key,range.upper)===0));
globalThis.IDBKeyRange={
  bound(lower,upper,lowerOpen=false,upperOpen=false) {
    return {lower,upper,lowerOpen,upperOpen};
  }
};

function fakeDatabase({hasStage=true}={}) {
  let states={
    images:new Map([['old:image',new Blob(['old image'],{type:'image/png'})]]),
    meta:new Map([
      ['current_generation_id',OLD],['restore_epoch','restore-OLD'],
      ['old:genome',{schema_version:1,marker:'BEFORE'}]
    ]),
    theater_frames:new Map([['old:theater',{marker:'BEFORE'}]]),
    ...(hasStage?{backup_v2_stage:new Map()}: {})
  };
  let failSwapAt=Infinity,swapPuts=0,failStageAt=Infinity,stagePuts=0;
  const txLog=[];
  const db={
    name:DB,version:3,objectStoreNames:{contains:s=>!!states[s]},
    transaction(storeNames,mode){
      const names=typeof storeNames==='string'?[storeNames]:[...storeNames];
      if(names.some(n=>!states[n]))throw Error('NotFoundError');
      txLog.push({names,mode});
      let staged=Object.fromEntries(names.map(n=>[n,new Map(states[n])]));
      const ops=[];let active=true,running=false;
      const tx={
        error:null,oncomplete:null,onabort:null,onerror:null,
        abort(){abort(Error('AbortError'))},
        objectStore(name){
          if(!names.includes(name))throw Error('Store not in scope');
          const stage=name==='backup_v2_stage';
          const keyOf=(key)=>stage?JSON.stringify(key):key;
          const getEntries=(range)=>[...staged[name].entries()].map(([stored,val])=>
            stage?{stored,key:clone(val.__key),value:clone(val.value)}:
              {stored,key:stored,value:clone(val)}
            ).filter(x=>inside(x.key,range)).sort((a,b)=>cmp(a.key,b.key));
          const put=(value,key,unique=false)=>{
            if(mode!=='readwrite')throw Error('ReadOnlyError');
            enqueue(()=>{
              const k=keyOf(key);
              if(unique&&staged[name].has(k))throw Error('ConstraintError');
              if(stage&&mode==='readwrite'&&++stagePuts===failStageAt)
                throw Error('QuotaExceededError');
              if(names.length===4&&name!=='backup_v2_stage'&&
                 ++swapPuts===failSwapAt)throw Error('QuotaExceededError');
              staged[name].set(k,stage?{__key:clone(key),value:clone(value)}:clone(value));
            });
          };
          return {
            put(value,key){put(value,key)},
            add(value,key){put(value,key,true)},
            clear(){enqueue(()=>staged[name].clear())},
            get(key){
              const req={result:null,onsuccess:null,onerror:null};
              enqueue(()=>{const val=staged[name].get(keyOf(key));
                req.result=val?clone(stage?val.value:val):undefined;req.onsuccess?.();});
              return req;
            },
            count(range){
              const req={result:undefined,onsuccess:null,onerror:null};
              enqueue(()=>{req.result=getEntries(range).length;req.onsuccess?.();});
              return req;
            },
            openCursor(range){
              const req={result:null,onsuccess:null,onerror:null};let prev=null;
              function next(){
                const rows=getEntries(range);
                const item=rows.find(x=>prev===null||cmp(x.key,prev)>0);
                req.result=item?{
                  key:clone(item.key),value:clone(item.value),
                  continue(){prev=item.key;enqueue(next)},
                  delete(){
                    if(mode!=='readwrite')throw Error('ReadOnlyError');
                    enqueue(()=>staged[name].delete(item.stored));
                  }
                }:null;
                req.onsuccess?.();
              }
              enqueue(next);
              return req;
            }
          };
        }
      };
      function abort(error){
        if(!active)return;
        active=false;tx.error=error;ops.length=0;
        setImmediate(()=>tx.onabort?.());
      }
      function enqueue(fn){
        if(!active)throw Error('TransactionInactiveError');
        ops.push(fn);
        if(!running){running=true;setImmediate(pump);}
      }
      function pump(){
        if(!active)return;
        const fn=ops.shift();
        if(!fn){
          active=false;
          if(mode==='readwrite')for(const name of names)states[name]=staged[name];
          tx.oncomplete?.();
          return;
        }
        try{fn();}
        catch(error){abort(error);return;}
        setImmediate(pump);
      }
      return tx;
    }
  };
  return {db,txLog,
    setFailSwapAt(n){failSwapAt=n;swapPuts=0},
    setFailStageAt(n){failStageAt=n;stagePuts=0},
    snapshot(){return {
      images:[...states.images.keys()],
      meta:[...states.meta.keys()],
      theater_frames:[...states.theater_frames.keys()],
      pointer:states.meta.get('current_generation_id'),
      epoch:states.meta.get('restore_epoch')
    }},
    getStageSize(id){return [...(states.backup_v2_stage?.values()||[])]
      .filter(v=>v.__key[0]===id).length},
    mutateStage(id,kind){
      if(kind==='delete') {
        const first=[...states.backup_v2_stage].find(([,v])=>v.__key[0]===id);
        states.backup_v2_stage.delete(first[0]);
      } else if(kind==='badPointer') {
        const row=[...states.backup_v2_stage].find(([,v])=>
          v.__key[0]===id&&v.__key[1]==='meta'&&v.__key[2]==='current_generation_id');
        if(!row)throw Error('pointer not found');
        row[1].value.value=OLD;
      } else if(kind==='changeStageIdentity') {
        // A second incarnation of the same stage ID has the same count and
        // data keys, but must never inherit the first attempt's proof.
        for(const row of states.backup_v2_stage.values()){
          if(row.__key[0]===id)row.value.stageToken='restore-'+'f'.repeat(32);
        }
      } else if(kind==='replaceRequiredImage'||kind==='replaceRequiredGenome'){
        // Alter a required row to a plausible wrong suffix, retaining
        // the exact same total count and per-store counts.
        const store=kind==='replaceRequiredImage'?'images':'meta';
        const oldKey=kind==='replaceRequiredImage'?
          GEN+':01':'genome:'+GEN+':01';
        const fakeKey=kind==='replaceRequiredImage'?
          GEN+':61':'genome:'+GEN+':61';
        const row=[...states.backup_v2_stage].find(([,v])=>
          v.__key[0]===id&&v.__key[1]===store&&v.__key[2]===oldKey);
        if(!row)throw Error('required stage row missing');
        states.backup_v2_stage.delete(row[0]);
        const newKey=[id,store,fakeKey];
        states.backup_v2_stage.set(JSON.stringify(newKey),{
          __key:newKey,value:{...row[1].value,key:fakeKey}
        });
      }
    }
  };
}

async function* records({badGenome=false,badBlob=false}={}){
  for(let i=1;i<=60;i++){
    const bytes=badBlob&&i===60?new Uint8Array([]):new Uint8Array([137,80,78,71,i]);
    yield {store:'images',key:GEN+':'+id(i),value:new Blob([bytes],{type:'image/png'})};
  }
  yield {store:'meta',key:'current_generation_id',value:GEN};
  for(let i=1;i<=60;i++)yield {store:'meta',key:'genome:'+GEN+':'+id(i),
    value:{schema_version:badGenome&&i===60?42:1,marker:'FROM-BACKUP',index:i}};
  yield {store:'theater_frames',key:'theater:'+GEN,value:{marker:'FROM-BACKUP'}};
}
async function makeFiles(opts={}){
  const files=[];
  const output=await writePartsFromRecords(records(opts),{
    mode:'cryptic',database:DB,currentGeneration:GEN,maxPartBytes:1500,maxPartEntries:7
  },async file=>files.push(file));
  return {...output,files};
}
const partApi={verifyPartIntegrity,validateManifest,MAX_MANIFEST_BYTES};
const checkGenome=(genome,index)=>{
  if(genome.schema_version!==1||genome.index!==index)throw Error('Invalid genome '+index);
};
const checkMothPng=async(blob,index)=>{
  if(!(blob instanceof Blob)||blob.type!=='image/png'||blob.size<5)
    throw Error('Invalid PNG '+index);
};
const cryptoApi={getRandomValues(arr){arr.fill(0x19);return arr;}};
async function stage(env,parts,idValue=stageId){
  return restore.stageValidatedBackup({
    db:env.db,stageId:idValue,manifestFile:parts.manifestFile,
    partFiles:parts.files,mode:'cryptic',database:DB,partApi,semanticApi:semantic,
    checkGenome,checkMothPng,batchSize:9
  });
}
async function errorMatching(p,pattern){await assert.rejects(p,pattern);}

(async()=>{
  const files=await makeFiles();
  const env=fakeDatabase();
  const before=env.snapshot();
  assert.equal(before.pointer,OLD);
  assert.equal(restore.makeStageId(cryptoApi),'restore-'+'19'.repeat(16));
  await errorMatching(restore.stageValidatedBackup({
    db:{...env.db,name:'gitai-exhibit-2026-cryptic'},stageId,
    manifestFile:files.manifestFile,partFiles:files.files,
    mode:'cryptic',database:DB,partApi,semanticApi:semantic,
    checkGenome,checkMothPng
  }),/実験用v3/);
  const badDb=fakeDatabase({hasStage:false});
  await errorMatching(stage(badDb,files),/実験用v3/);
  assert.deepEqual(badDb.snapshot().images,before.images);

  const prepared=await stage(env,files);
  assert.equal(prepared.entries,122);
  assert.equal(prepared.generation,GEN);
  assert.equal(prepared.stageComplete,true);
  assert.match(prepared.stageToken,/^restore-[a-f0-9]{32}$/,
    'verified staging has a per-attempt ownership identity');
  assert.equal(prepared.lifeRestored,false);
  assert.deepEqual(env.snapshot(),before,'staging must not touch live stores');
  assert.equal(env.getStageSize(stageId),122);
  await errorMatching(stage(env,files),/すでに使われています/);
  assert.equal(env.getStageSize(stageId),122);

  // Partial semantic validation fails BEFORE the first stage PUT.
  const invalid=await makeFiles({badGenome:true});
  const envBad=fakeDatabase();
  await errorMatching(stage(envBad,invalid),/Invalid genome/);
  assert.equal(envBad.getStageSize(stageId),0);
  assert.deepEqual(envBad.snapshot(),before);
  const invalidBlob=await makeFiles({badBlob:true});
  await errorMatching(stage(envBad,invalidBlob),/Invalid PNG/);
  assert.equal(envBad.getStageSize(stageId),0);

  // A second-pass SHA failure happens AFTER earlier stage batches; cleanup
  // must erase only those temporary rows and leave old data untouched.
  let verifyPass=0;
  const changingApi={...partApi,
    async verifyPartIntegrity(...args){
      if(++verifyPass===1) return verifyPartIntegrity(...args);
      const badFiles=args[1].slice();
      const f=badFiles[badFiles.length-1];
      badFiles[badFiles.length-1]=new File(['!' +(await f.text()).slice(1)],
        f.name,{type:'application/json'});
      return verifyPartIntegrity(args[0],badFiles,...args.slice(2));
    }
  };
  const envTampered=fakeDatabase();
  await errorMatching(restore.stageValidatedBackup({
    db:envTampered.db,stageId,manifestFile:files.manifestFile,
    partFiles:files.files,mode:'cryptic',database:DB,
    partApi:changingApi,semanticApi:semantic,checkGenome,checkMothPng,batchSize:9
  }),/破損/);
  assert.equal(envTampered.getStageSize(stageId),0);
  assert.deepEqual(envTampered.snapshot(),before);

  // Mid-stream quota exhaustion after some completed temporary batches:
  // no original store has changed, and cleanup erases committed temp batches.
  const stageQuota=fakeDatabase();
  stageQuota.setFailStageAt(15);
  await errorMatching(stage(stageQuota,files),/QuotaExceededError/);
  assert.equal(stageQuota.getStageSize(stageId),0);
  assert.deepEqual(stageQuota.snapshot(),before);

  // Same-ID race between TWO staging clients: both observed an empty
  // stage, but client B commits first. Client A's first add() collides.
  // Its error handler must not erase B's valid staged data.
  const collision=fakeDatabase();
  let verifyCalls=0,winner=null;
  const delayedApi={...partApi,
    async verifyPartIntegrity(...args){
      verifyCalls++;
      if(verifyCalls===2)winner=await stage(collision,files);
      return verifyPartIntegrity(...args);
    }
  };
  await errorMatching(restore.stageValidatedBackup({
    db:collision.db,stageId,manifestFile:files.manifestFile,
    partFiles:files.files,mode:'cryptic',database:DB,
    partApi:delayedApi,semanticApi:semantic,checkGenome,checkMothPng,
    batchSize:9
  }),/ConstraintError/);
  assert.ok(winner?.stageComplete);
  assert.equal(collision.getStageSize(stageId),122,
    'losing concurrent staging operation must preserve winning stage');
  assert.deepEqual(collision.snapshot(),before,
    'a staging collision cannot modify live evolution');
  const winnerResult=await restore.commitStagedRestore(collision.db,winner,{cryptoApi});
  assert.equal(winnerResult.status,'db-committed',
    'winning stage remains independently restorable');
  assert.equal(collision.snapshot().pointer,GEN);

  // Same row count, same pointer, same key set, different staging identity:
  // refuse to overwrite previous data even if the stage was swapped while
  // keeping all visible content counters intact.
  const swapped=fakeDatabase();
  const originalStage=await stage(swapped,files);
  swapped.mutateStage(stageId,'changeStageIdentity');
  assert.equal(swapped.getStageSize(stageId),122);
  await errorMatching(
    restore.commitStagedRestore(swapped.db,originalStage,{cryptoApi}),
    /Staged restore row is corrupt/);
  assert.deepEqual(swapped.snapshot(),before);
  assert.equal(swapped.getStageSize(stageId),122,
    'failed commit must not delete an unknown stage incarnation');

  // Abort in the middle of the four-store transaction restores ALL old
  // records; a partial clear() must never leak to committed state.
  env.setFailSwapAt(15);
  await errorMatching(restore.commitStagedRestore(env.db,prepared,{cryptoApi}),
    /QuotaExceededError/);
  assert.deepEqual(env.snapshot(),before);
  assert.equal(env.getStageSize(stageId),122);

  // An injected browser transaction abort after multiple PUTs also must
  // roll back every cleared live store. This injection is sandbox-only and
  // deterministic; it is NOT a simulated OS crash or storage quota limit.
  await errorMatching(restore.commitStagedRestore(env.db,prepared,{
    cryptoApi,simulateAbortAfterRecords:15
  }),/Isolated simulated transaction abort/);
  assert.deepEqual(env.snapshot(),before);
  assert.equal(env.getStageSize(stageId),122);

  // Missing staged row (e.g. interrupted cleanup) must abort after clear()
  // is queued, atomically rolling back the original images/meta/theater.
  const envMissing=fakeDatabase();
  const preparedMissing=await stage(envMissing,files);
  envMissing.mutateStage(stageId,'delete');
  await errorMatching(restore.commitStagedRestore(envMissing.db,preparedMissing,{cryptoApi}),
    /Incomplete restore stage/);
  assert.deepEqual(envMissing.snapshot(),before);

  // Same count, forged/stale generation pointer: reject and rollback.
  const envWrong=fakeDatabase();
  const preparedWrong=await stage(envWrong,files);
  envWrong.mutateStage(stageId,'badPointer');
  await errorMatching(restore.commitStagedRestore(envWrong.db,preparedWrong,{cryptoApi}),
    /Stage generation mismatch/);
  assert.deepEqual(envWrong.snapshot(),before);

  // A forged suffix can preserve totals and still replace a
  // REQUIRED 01..60 key. Never mistake genNNNNN:61 for genNNNNN:01.
  for(const mutation of ['replaceRequiredImage','replaceRequiredGenome']){
    const forged=fakeDatabase();
    const checked=await stage(forged,files);
    forged.mutateStage(stageId,mutation);
    assert.equal(forged.getStageSize(stageId),122);
    await errorMatching(restore.commitStagedRestore(forged.db,checked,{cryptoApi}),
      /Incomplete staged genome\/images/);
    assert.deepEqual(forged.snapshot(),before,
      'a forged key with matching counts must preserve old data');
  }

  // Retry the VALID fully staged state when quota is freed.
  env.setFailSwapAt(Infinity);
  const result=await restore.commitStagedRestore(env.db,prepared,{cryptoApi});
  assert.equal(result.status,'db-committed');
  assert.equal(result.lifeRestored,false);
  assert.equal(result.entries,122);
  assert.equal(result.generation,GEN);
  assert.equal(env.getStageSize(stageId),0);
  assert.equal(env.snapshot().pointer,GEN);
  assert.equal(env.snapshot().epoch,'restore-'+'19'.repeat(16));
  assert.equal(env.snapshot().images.length,60);
  assert.equal(env.snapshot().theater_frames.length,1);
  assert.equal(env.snapshot().meta.length,62,'60 genomes + generation + epoch');
  assert.ok(!env.snapshot().images.includes('old:image'));
  assert.ok(!env.snapshot().meta.includes('old:genome'));
  assert.ok(env.txLog.some(x=>x.names.length===4&&x.mode==='readwrite'));

  // Cancellation only removes temporary rows; original state must survive.
  const cancellation=fakeDatabase();
  const cancellationPlan=await stage(cancellation,files);
  await errorMatching(restore.discardStage(cancellation.db,stageId,
    {expectedStageToken:'restore-'+'f'.repeat(32)}),
    /ownership changed/);
  assert.equal(cancellation.getStageSize(stageId),122,
    'mismatched cleanup token cannot delete any valid stage rows');
  assert.deepEqual(cancellation.snapshot(),before);
  const removed=await restore.discardStage(cancellation.db,stageId,
    {expectedStageToken:cancellationPlan.stageToken});
  assert.equal(removed,122);
  assert.equal(cancellation.getStageSize(stageId),0);
  assert.deepEqual(cancellation.snapshot(),before);
  console.log('RE2-EXH-02: stage ownership tokens protect same-ID concurrent staging and same-count replacement; quota abort/partial cleanup preserve live stores; 122-row atomic restore/epoch rotation OK. Sandbox only.');
})().catch(e=>{console.error(e);process.exitCode=1;});
