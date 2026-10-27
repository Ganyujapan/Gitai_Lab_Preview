'use strict';
// CI for warning-life post-restore protocol. Isolated synthetic DB and
// synthetic localStorage only. The existing warning game life key is NEVER used.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {writePartsFromRecords,validateManifest,MAX_MANIFEST_BYTES}=
  require('../../exhibit/backup_v2.js');
const life=require('../../exhibit/backup_warning_life_recovery_v2.js');
for(const file of [
  'exhibit/backup_warning_life_recovery_v2.js',
  'exhibit/backup_warning_life_rehearsal.js'
])new vm.Script(fs.readFileSync(file,'utf8'),{filename:file});
const html=fs.readFileSync('exhibit/backup_rehearsal.html','utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(script);
new vm.Script(script[1],{filename:'backup_rehearsal.html'});
assert.match(html,/id="runLife"/);
assert.match(html,/lifeButton\.addEventListener\('click'/);
assert.match(html,/GitaiWarningLifeRehearsal\.runRehearsal/);
assert.match(html,/本物の進化データやゲームのライフには触れません/);
const browser=fs.readFileSync('exhibit/backup_warning_life_rehearsal.js','utf8');
assert.match(browser,/schemaApi\.uniqueSandboxName\(cryptoApi\)/);
assert.match(browser,/lifeStorage\.removeItem\(key\)/);
assert.match(browser,/await removeDb\(indexedDb,name\)/);
assert.match(browser,/Synthetic localStorage SecurityError/);
assert.doesNotMatch(browser,/gitai-warning-life-v1:/);
const build=fs.readFileSync('exhibit/build.py','utf8');
assert.match(build,/backup_warning_life_recovery_v2\.js/);
assert.match(build,/backup_warning_life_rehearsal\.js/);
for(const production of ['exhibit/index.html','exhibit/modes.html',
  'exhibit/admin.js','exhibit/game.js','exhibit/landing.js']){
  const data=fs.readFileSync(production,'utf8');
  assert.doesNotMatch(data,/backup_warning_life_recovery_v2/);
  assert.doesNotMatch(data,/backup_warning_life_rehearsal/);
}
const DB='gitai-backup-rehearsal-'+'a'.repeat(32);
const GEN='gen00035',EPOCH='restore-'+'b'.repeat(32);
const partApi={validateManifest,MAX_MANIFEST_BYTES};
if(typeof File==='undefined')globalThis.File=class extends Blob {
  constructor(parts,name,opts){super(parts,opts);this.name=name;}
};
function makeDb(name=DB){
  const data=new Map([['current_generation_id',GEN],['restore_epoch',EPOCH]]);
  let accesses=0;
  const db={name,version:3,
    objectStoreNames:{contains:s=>['meta','images','theater_frames','backup_v2_stage'].includes(s)},
    transaction(name,mode){
      accesses++;
      assert.equal(name,'meta');
      assert.equal(mode,'readonly');
      const reqs=[];
      const tx={oncomplete:null,onabort:null,onerror:null,error:null,
        objectStore(store){
          assert.equal(store,'meta');
          return {
            get(key){
              const req={onsuccess:null,onerror:null,result:undefined};
              reqs.push({key,req});
              if(reqs.length===2)setImmediate(()=>{
                for(const {key,req} of reqs){
                  req.result=data.get(key);req.onsuccess?.();
                }
                tx.oncomplete?.();
              });
              return req;
            }
          };
        }
      };
      return tx;
    }
  };
  return {db,data,getAccesses:()=>accesses};
}
function storage(){
  const m=new Map(),writes=[];
  let failSet=false,failRead=false,failRemove=false;
  return {
    setItem(key,val){
      writes.push(['set',key,val]);
      if(failSet)throw Error('SecurityError mock');
      m.set(key,String(val));
    },
    getItem(key){if(failRead)throw Error('Quota inaccessible');return m.get(key)??null;},
    removeItem(key){
      writes.push(['remove',key]);
      if(failRemove)throw Error('Removal blocked');
      m.delete(key);
    },
    getWrites(){return writes},setFailure(v){failSet=v},readFailure(v){failRead=v},
    removeFailure(v){failRemove=v}
  };
}
async function* records(){
  for(let i=1;i<=60;i++)yield {store:'images',key:GEN+':'+String(i).padStart(2,'0'),
    value:new Blob(['png'])};
  yield {store:'meta',key:'current_generation_id',value:GEN};
  for(let i=1;i<=60;i++)yield {store:'meta',
    key:'genome:'+GEN+':'+String(i).padStart(2,'0'),value:{alleles:[0,1]}};
  yield {store:'theater_frames',key:'frame:'+GEN,value:{a:1}};
}
async function manifest(warningLife){
  const fileList=[];
  const output=await writePartsFromRecords(records(),{
    mode:'warning',database:DB,currentGeneration:GEN,
    warningLife,maxPartEntries:120
  },async file=>fileList.push(file));
  assert.equal(output.manifest.totals.entries,122);
  return output.manifestFile;
}
function commit(entries=122){
  return {status:'db-committed',generation:GEN,epoch:EPOCH,
    entries,lifeRestored:false};
}
async function pending(env,mf,committed=commit()){
  return life.makePendingLifePlan({db:env.db,manifestFile:mf,committed,partApi});
}
const resultWith=(env,plan,store)=>life.applyPendingLife({db:env.db,plan,storage:store});
(async()=>{
  assert.equal(life.KEY_PREFIX,'gitai-warning-life-sandbox-v2:');
  const lifeJson=JSON.stringify({generation_id:GEN,thirds:7});
  const mf=await manifest(lifeJson);
  const env=makeDb(),store=storage();
  const plan=await pending(env,mf);
  assert.equal(plan.status,'life-pending');
  assert.equal(plan.warningLife,lifeJson);
  assert.equal(plan.generation,GEN);
  assert.equal(plan.epoch,EPOCH);
  assert.equal(plan.storageKey,life.KEY_PREFIX+DB);
  assert.equal(store.getWrites().length,0,'plan creation is read-only');
  const ok=await resultWith(env,plan,store);
  assert.equal(ok.status,'life-complete');
  assert.equal(ok.lifeRestored,true);
  assert.equal(store.getItem(plan.storageKey),lifeJson);
  assert.ok(store.getWrites().every(a=>a[1].startsWith(life.KEY_PREFIX)));
  assert.ok(env.getAccesses()>=3,'epoch must be re-read around life write');

  const broken=storage();broken.setFailure(true);
  const afterFailed=await resultWith(env,plan,broken);
  assert.equal(afterFailed.status,'life-pending');
  assert.equal(afterFailed.lifeRestored,false);
  assert.match(afterFailed.detail,/SecurityError mock/);
  assert.equal(broken.getItem(plan.storageKey),null);
  broken.setFailure(false);
  const retry=await resultWith(env,plan,broken);
  assert.equal(retry.status,'life-complete');
  assert.equal(broken.getItem(plan.storageKey),lifeJson);

  const staleEnv=makeDb(),staleStore=storage();
  const stalePlan=await pending(staleEnv,mf);
  staleEnv.data.set('restore_epoch','restore-'+'c'.repeat(32));
  const stale=await resultWith(staleEnv,stalePlan,staleStore);
  assert.equal(stale.status,'stale');
  assert.equal(stale.lifeRestored,false);
  assert.equal(staleStore.getWrites().length,0);

  const moved=makeDb(),movedStore=storage();
  const movedPlan=await pending(moved,mf);
  moved.data.set('current_generation_id','gen00036');
  assert.equal((await resultWith(moved,movedPlan,movedStore)).status,'stale');
  assert.equal(movedStore.getWrites().length,0);

  const remove=makeDb(),nullManifest=await manifest(null),nullStore=storage();
  const nullPlan=await pending(remove,nullManifest);
  nullStore.setItem(nullPlan.storageKey,'stale');
  assert.equal((await resultWith(remove,nullPlan,nullStore)).status,'life-complete');
  assert.equal(nullStore.getItem(nullPlan.storageKey),null);

  const removalDenied=storage();
  removalDenied.setItem(nullPlan.storageKey,'stale');
  removalDenied.removeFailure(true);
  const incomplete=await resultWith(remove,nullPlan,removalDenied);
  assert.equal(incomplete.status,'life-pending');
  assert.equal(removalDenied.getItem(nullPlan.storageKey),'stale');
  removalDenied.removeFailure(false);
  assert.equal((await resultWith(remove,nullPlan,removalDenied)).status,'life-complete');

  await assert.rejects(pending(makeDb(),mf,{...commit(),status:'failed'}),
    /確定が確認できません/);
  await assert.rejects(pending(makeDb(),mf,{...commit(),lifeRestored:true}),
    /確定が確認できません/);
  await assert.rejects(pending(makeDb(),mf,commit(123)),/一致しません/);
  // Invalid life is rejected when creating the backup manifest itself.
  await assert.rejects(manifest(JSON.stringify({generation_id:GEN,thirds:31})),
    /ライフ/);
  await assert.rejects(manifest(JSON.stringify({generation_id:'gen00034',thirds:4})),
    /ライフ/);
  await assert.rejects(pending(makeDb('gitai-exhibit-2026-warning'),mf),
    /隔離DB/);
  const forgedPlan={...plan};
  await assert.rejects(resultWith(env,forgedPlan,storage()),/復元計画/);
  const wrongDb=makeDb('gitai-backup-rehearsal-'+'d'.repeat(32));
  await assert.rejects(resultWith(wrongDb,plan,storage()),/復元計画/);
  await assert.rejects(resultWith(env,plan,{}),/ストレージ/);

  // A storage API that silently drops writes may NEVER report success.
  const drop={getItem:()=>null,setItem(){},removeItem(){}};
  const dropResult=await resultWith(env,plan,drop);
  assert.equal(dropResult.status,'life-pending');
  assert.equal(dropResult.lifeRestored,false);

  console.log('RE2-EXH-02 warning-life: isolated v3 only; pending/complete/partial/stale; epoch and generation fences; retry on storage denial; null removal; exact warning manifest; no production life key or readwrite DB transactions.');
})().catch(e=>{console.error(e);process.exitCode=1;});
