'use strict';
// EXH-02: run the REAL opt-in read-only inspector against a deterministic
// IndexedDB event model; no real browser DB, files or user data are opened.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const inspector=require('../../exhibit/backup_readiness.js');
const source=fs.readFileSync('exhibit/backup_readiness.js','utf8');
const admin=fs.readFileSync('exhibit/admin.js','utf8');
const modes=fs.readFileSync('exhibit/modes.html','utf8');
const build=fs.readFileSync('exhibit/build.py','utf8');
new vm.Script(source,{filename:'exhibit/backup_readiness.js'});
const NAME='gitai-exhibit-2026-gitai-pages-preview-v3-kusagi_001-continuous_v1-konchu2026_cryptic';
const GEN='gen00042';
const suffix=i=>String(i).padStart(2,'0');
function fixture({missingDb=false,version=2,omitStore=null,
                  noGeneration=false,missingImage=null,missingDna=null,
                  entryCount=null,txAbort=false,blocked=false}={}){
  let openCount=0,mutations=0,closes=0,readValueCount=0,readKeyCount=0;
  const images=new Map(), meta=new Map(),theater_frames=new Map();
  for(let i=1;i<=60;i++){
    if(i!==missingImage)images.set(GEN+':'+suffix(i),null);
    if(i!==missingDna)meta.set('genome:'+GEN+':'+suffix(i),null);
  }
  if(!noGeneration)meta.set('current_generation_id',GEN);
  theater_frames.set('frame:01',null);
  const data={images,meta,theater_frames};
  const storedNames=Object.keys(data).filter(n=>n!==omitStore);
  const db={
    version,objectStoreNames:{contains:n=>storedNames.includes(n)},
    close(){closes++;},
    transaction(names,mode){
      assert.equal(mode,'readonly','inspector must never use readwrite');
      assert.deepEqual(Array.from(names),['images','meta','theater_frames']);
      const tx={oncomplete:null,onerror:null,onabort:null,error:null};
      let queue=[],scheduled=false;
      function pump(){
        if(scheduled)return;
        scheduled=true;
        queueMicrotask(()=>{
          scheduled=false;
          if(txAbort){
            tx.error=Error('Synthetic IDB abort');
            tx.onabort?.();return;
          }
          const job=queue.shift();
          if(job){
            job();pump();
          }else tx.oncomplete?.();
        });
      }
      function enqueue(produce){
        const req={result:undefined,error:null,onsuccess:null,onerror:null};
        queue.push(()=>{req.result=produce();req.onsuccess?.();});
        pump();
        return req;
      }
      return Object.assign(tx,{objectStore(store){
        assert.ok(data[store],'unexpected store '+store);
        return {
          count(){
            return enqueue(()=>entryCount!=null&&store==='meta'?
              entryCount:data[store].size);
          },
          get(key){
            readValueCount++;
            assert.equal(key,'current_generation_id','no genome/blob value reads');
            return enqueue(()=>data[store].get(key));
          },
          getKey(key){
            readKeyCount++;
            return enqueue(()=>data[store].has(key)?key:undefined);
          },
          put(){mutations++;throw Error('Unexpected IDB PUT');},
          delete(){mutations++;throw Error('Unexpected IDB DELETE');},
          clear(){mutations++;throw Error('Unexpected IDB CLEAR');}
        };
      }});
    }
  };
  const indexedDb={open(name,requestedVersion){
    openCount++;
    assert.equal(name,NAME);
    assert.equal(requestedVersion,undefined,
      'must not request schema upgrade or create version-2 DB');
    const req={result:null,error:null,onupgradeneeded:null,
      onblocked:null,onerror:null,onsuccess:null};
    queueMicrotask(()=>{
      if(missingDb){
        const tx={abort(){req.error=Error('AbortError');queueMicrotask(()=>req.onerror?.());}};
        req.onupgradeneeded?.({oldVersion:0,target:{transaction:tx}});
        return;
      }
      if(blocked)req.onblocked?.();
      req.result=db;req.onsuccess?.();
    });
    return req;
  }};
  return {indexedDb,db,data,
    get opens(){return openCount},get closes(){return closes},
    get mutations(){return mutations},get values(){return readValueCount},
    get keys(){return readKeyCount}
  };
}
(async()=>{
  assert.equal(inspector.MAX_V1_ENTRIES,20000);
  const ok=fixture();
  const health=await inspector.inspect({name:NAME,indexedDb:ok.indexedDb,
    storage:{estimate:async()=>({usage:31457280,quota:209715200})}});
  assert.equal(health.status,'eligible-for-v1-check');
  assert.equal(health.generation,GEN);
  assert.equal(health.total,122);
  assert.deepEqual({...health.counts},{images:60,meta:61,theater_frames:1});
  assert.equal(health.missingImages,0);assert.equal(health.missingGenomes,0);
  assert.equal(health.exportVerified,false,'readiness must not promise export');
  assert.equal(health.readOnly,true);
  assert.deepEqual({...health.originStorage},{usage:31457280,quota:209715200});
  assert.equal(ok.opens,1);assert.equal(ok.closes,1);
  assert.equal(ok.values,1,'only read generation pointer as a value');
  assert.equal(ok.keys,120,'verify all 60 image and DNA keys');
  assert.equal(ok.mutations,0);

  const oversize=fixture({entryCount:20100});
  const huge=await inspector.inspectDatabase(NAME,oversize.indexedDb);
  assert.equal(huge.status,'v1-entry-limit');
  assert.equal(huge.total,20161);
  assert.match(inspector.format({...huge,originStorage:{usage:null,quota:null}},
    '隠れるギタイ'),/20,000件を超えています/);
  assert.doesNotMatch(inspector.format({...huge,originStorage:{usage:null,quota:null}},
    '隠れるギタイ'),/復元できます|書き出し成功です/);
  assert.equal(oversize.mutations,0);

  const lost=fixture({missingImage:1,missingDna:60});
  const missing=await inspector.inspectDatabase(NAME,lost.indexedDb);
  assert.equal(missing.status,'incomplete');
  assert.equal(missing.missingImages,1);assert.equal(missing.missingGenomes,1);
  assert.equal(lost.keys,120);assert.equal(lost.mutations,0);
  assert.match(inspector.format({...missing,originStorage:{}},'目立つギタイ'),
    /不足があります/);
  const unplayed=fixture({noGeneration:true});
  const noPointer=await inspector.inspectDatabase(NAME,unplayed.indexedDb);
  assert.equal(noPointer.status,'not-ready');
  assert.equal(unplayed.keys,0);
  assert.equal(unplayed.mutations,0);

  const notCreated=fixture({missingDb:true});
  await assert.rejects(inspector.inspectDatabase(NAME,notCreated.indexedDb),
    /まだ実験データがありません/);
  assert.equal(notCreated.opens,1);
  assert.equal(notCreated.mutations,0,
    'onupgradeneeded must abort rather than create an empty user DB');

  const old=fixture({version:3});
  await assert.rejects(inspector.inspectDatabase(NAME,old.indexedDb),
    /保存データベースの形式/);
  assert.equal(old.closes,1);
  const badStore=fixture({omitStore:'theater_frames'});
  await assert.rejects(inspector.inspectDatabase(NAME,badStore.indexedDb),
    /保存データベースの形式/);
  assert.equal(badStore.closes,1);
  const aborted=fixture({txAbort:true});
  await assert.rejects(inspector.inspectDatabase(NAME,aborted.indexedDb),
    /Synthetic IDB abort/);
  assert.equal(aborted.closes,1);
  const conflict=fixture({blocked:true});
  await assert.rejects(inspector.inspectDatabase(NAME,conflict.indexedDb),
    /他のタブ/);
  assert.equal(conflict.closes,1,
    'late success after blocked must be closed');

  const unavailable=await inspector.inspect({
    name:NAME,indexedDb:fixture().indexedDb,
    storage:{estimate:async()=>{throw Error('No permissions');}}
  });
  assert.deepEqual({...unavailable.originStorage},{usage:null,quota:null});
  assert.match(inspector.format(health,'隠れるギタイ'),/両モード共通/);
  assert.match(inspector.format(health,'隠れるギタイ'),/保証するものではありません/);
  assert.match(inspector.format(health,'隠れるギタイ'),/バックアップファイルを作成しません/);
  await assert.rejects(inspector.inspectDatabase('../unsafe',fixture().indexedDb),
    /保存先/);

  assert.match(modes,/id="exhibitBackupReadiness"/);
  assert.match(modes,/id="exhibitBackupReadinessResult"/);
  assert.match(modes,/src="backup_readiness\.js" defer/);
  assert.ok(modes.indexOf('src="backup_readiness.js"')<
    modes.indexOf('src="admin.js"'), 'load preflight before admin');
  assert.match(admin,/readinessButton\.addEventListener\('click',async\(\)=>/);
  assert.match(admin,/if\(!unlocked\)return/);
  assert.match(admin,/api\.inspect\(\{/);
  assert.match(admin,/api\.format\(result,selectedMode\.label\)/);
  assert.match(build,/"backup_readiness\.js"/);
  assert.match(build,/assert "backup_readiness\.js" in runtime_files/);
  const css=fs.readFileSync('exhibit/admin.css','utf8');
  assert.match(css,/#exhibitBackupReadinessResult/);
  for(const production of ['exhibit/index.html','exhibit/game.js',
    'exhibit/landing.js']){
    assert.doesNotMatch(fs.readFileSync(production,'utf8'),
      /backup_readiness\.js/,'read-only inspector must be admin-only');
  }
  console.log('EXH-02: production read-only iPad backup readiness inspector, 120 exact key probes, 20k limit warning, nonexistent DB abort, closed connections, no writes and no misleading export guarantee verified.');
})().catch(error=>{console.error(error);process.exitCode=1});
