'use strict';
// STO-02 regression: evaluate the real registry source in TWO independent
// browser tabs sharing a serializable IndexedDB simulation and localStorage.
// This never touches an actual visitor's saved experiments.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('js/experiment_registry.js','utf8');
const ui=fs.readFileSync('js/experiment_saves.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const tag1=html.indexOf('src="js/experiment_registry.js');
const tag2=html.indexOf('src="js/experiment_saves.js');
assert.ok(tag1>0 && tag2>tag1,'Atomic registry must load before save controls');
assert.match(html,/experiment_saves\.js\?v=20261026-sto02/);
assert.match(ui,/await registry\.mutate\('add', record\)/);
assert.match(ui,/await registry\.mutate\('rename'/);
assert.match(ui,/await registry\.mutate\('remove'/);
assert.doesNotMatch(ui,/localStorage\.setItem\('gitai-experiment-records-v1'/);
assert.match(source,/db\.transaction\(STORE,mode\)/);
assert.match(source,/store\.get\(KEY\)/);
assert.match(source,/store\.put\(state,KEY\)/);
assert.match(source,/store\.put\(created,KEY\)/);

function environment(oldRecords=[],rawOverride) {
  const KEY='gitai-experiment-records-v1';
  const raw=rawOverride===undefined?
    JSON.stringify({version:1,records:oldRecords}):rawOverride;
  const local=new Map(raw===null?[]:[[KEY,raw]]);
  const state={canonical:new Map(),pending:[],busy:false,opened:0,failNextPut:false};
  const deep=v=>v===undefined?undefined:structuredClone(v);
  function runQueue(){
    if(state.busy || !state.pending.length)return;
    state.busy=true;
    const t=state.pending.shift(),stage=new Map([...state.canonical].map(([k,v])=>[k,deep(v)]));
    let aborted=false;
    const abort=error=>{
      if(aborted)return;
      aborted=true;t.error=error;
      setImmediate(()=>{t.onabort?.();state.busy=false;runQueue()});
    };
    t.abort=()=>abort(Error('AbortError'));
    function next(){
      if(aborted)return;
      const op=t.operations.shift();
      if(!op){
        state.canonical=stage;
        setImmediate(()=>{t.oncomplete?.();state.busy=false;runQueue()});
        return;
      }
      try{
        if(op.type==='get'){
          op.req.result=deep(stage.get(op.key));
          op.req.onsuccess?.();
        }else if(op.type==='put'){
          if(state.failNextPut){state.failNextPut=false;throw Error('QuotaExceededError')}
          stage.set(op.key,deep(op.value));
        }
        setImmediate(next);
      }catch(e){abort(e)}
    }
    setImmediate(next);
  }
  const database={
    onversionchange:null,
    close(){},
    objectStoreNames:{contains:store=>store==='state'},
    createObjectStore(){},
    transaction(name,mode){
      assert.equal(name,'state');
      assert.ok(['readonly','readwrite'].includes(mode));
      const t={oncomplete:null,onabort:null,onerror:null,error:null,operations:[],
        objectStore(store){
          assert.equal(store,'state');
          return {
            get(key){
              const req={onsuccess:null,result:undefined};
              t.operations.push({type:'get',key,req});return req;
            },
            put(value,key){
              assert.equal(mode,'readwrite');
              t.operations.push({type:'put',value,key});
            }
          };
        }
      };
      state.pending.push(t);setImmediate(runQueue);return t;
    }
  };
  const indexedDB={open(dbName,version){
    assert.equal(dbName,'gitai-experiment-registry-v2');
    assert.equal(version,1);
    state.opened++;
    const req={result:database,onsuccess:null,onerror:null,onupgradeneeded:null};
    setImmediate(()=>req.onsuccess?.());
    return req;
  }};
  const localStorage={
    getItem:key=>local.has(key)?local.get(key):null,
    setItem:(key,val)=>local.set(key,val),
    removeItem:key=>local.delete(key)
  };
  function tab(){
    const window={addEventListener(){}};
    const context={window,indexedDB,localStorage,location:{pathname:'/Gitai_Lab_Preview/'},
      document:{addEventListener(){},hidden:false},console,Set,Error,Date};
    vm.runInNewContext(source,context,{filename:'js/experiment_registry.js',timeout:1000});
    assert.ok(window.GitaiExperimentRegistry,'Registry must initialize for normal game');
    return window.GitaiExperimentRegistry;
  }
  return {tab,state,local,KEY};
}
function record(n){
 return {id:'exp_'+n,dbName:'game-'+n,name:'Experiment '+n,
   config:{env:'kusagi_001',model:'continuous_v1',run:'default',slot:'slot-'+n},
   savedGeneration:'gen00021',createdAt:'2026-10-26T08:00:00Z'};
}
function canonical(env) {
 const s=env.state.canonical.get('records');
 return s?.records || [];
}
(async()=>{
 // One-shot migration of preexisting localStorage v1 data is NONDESTRUCTIVE.
 const e=environment([record(1),record(2)]);
 const [a,b]=[e.tab(),e.tab()];
 await Promise.all([a.ready(),b.ready()]);
 assert.equal(canonical(e).length,2);
 assert.equal(e.local.get(e.KEY),JSON.stringify({version:1,records:[record(1),record(2)]}));
 const out=await Promise.all([
  a.mutate('add',record(3)),
  b.mutate('add',record(4))
 ]);
 assert.equal(out.length,2);
 assert.deepEqual(canonical(e).map(x=>x.id).sort(),['exp_1','exp_2','exp_3','exp_4']);
 assert.equal((await a.refresh()).length,4);
 assert.equal((await b.refresh()).length,4);
 assert.equal(e.local.get(e.KEY),JSON.stringify({version:1,records:[record(1),record(2)]}),
   'Legacy backup remains byte-for-byte unchanged after writes');
 const idempotent=await a.mutate('add',{...record(4),id:'exp_new'});
 assert.equal(idempotent.id,'exp_4');
 assert.equal(canonical(e).length,4,'A concurrent duplicate database cannot use an extra slot');
 await Promise.all([a.mutate('rename',{id:'exp_1',dbName:'game-1',name:'Renamed'}),
   b.mutate('add',record(5))]);
 assert.equal(canonical(e).find(x=>x.id==='exp_1').name,'Renamed');
 assert.ok(canonical(e).some(x=>x.id==='exp_5'));
 await Promise.all([a.mutate('remove',{id:'exp_2',dbName:'game-2'}),
   b.mutate('add',record(6))]);
 assert.ok(!canonical(e).some(x=>x.id==='exp_2'));
 assert.ok(canonical(e).some(x=>x.id==='exp_6'));
 assert.equal(canonical(e).length,5);

 // The 10-slot limit is tested AT COMMIT TIME, not using an old UI snapshot.
 const full=environment(Array.from({length:9},(_,i)=>record(i+1)));
 const [c,d]=[full.tab(),full.tab()];
 await Promise.all([c.ready(),d.ready()]);
 const joined=await Promise.allSettled([
  c.mutate('add',record(10)),
  d.mutate('add',record(11))
 ]);
 assert.equal(joined.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(joined.filter(x=>x.status==='rejected').length,1);
 assert.equal(canonical(full).length,10);
 assert.match(String(joined.find(x=>x.status==='rejected').reason),/スロットが満杯/);

 // A quota failure aborts without partially committing the metadata state.
 const fail=environment([record(1)]);
 const f=fail.tab();await f.ready();
 fail.state.failNextPut=true;
 await assert.rejects(f.mutate('add',record(2)),/QuotaExceededError/);
 assert.equal(canonical(fail).length,1);
 assert.equal((await f.refresh()).length,1);

 // Corrupted v1 must not be silently replaced by empty list.
 const broken=environment([], '{invalid json');
 await assert.rejects(broken.tab().ready(),/旧形式の保存記録/);
 assert.equal(broken.state.canonical.has('records'),false);
 assert.equal(broken.local.get(broken.KEY),'{invalid json');
 // Once v2 exists, old v1 is NEVER reimported even if an old tab writes it.
 const legacyChanged=environment([record(1)]);
 const migrated=legacyChanged.tab();await migrated.ready();
 await migrated.mutate('add',record(2));
 legacyChanged.local.set(legacyChanged.KEY,'{corrupted by an older tab');
 const reopened=legacyChanged.tab();await reopened.ready();
 assert.equal((await reopened.refresh()).length,2);
 assert.equal(canonical(legacyChanged).length,2);

 // A failing second-registered (rename) target must not overwrite anything.
 await assert.rejects(reopened.mutate('rename',{
   id:'missing',dbName:'missing-db',name:'Nope'
 }),/変更する実験が見つかりません/);
 assert.equal(canonical(legacyChanged).length,2);
 console.log('STO-02: atomic two-tab register/rename/delete, 10-slot limit, corrupted legacy fail-closed, retry and unchanged v1 backup OK');
})().catch(e=>{console.error(e);process.exitCode=1});
