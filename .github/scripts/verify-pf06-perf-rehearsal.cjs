'use strict';
// PF06: the real opt-in module against deterministic isolated IDB+DOM mocks.
// It MUST NOT touch production DB names or open any DB before button action.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const api=require('../../exhibit/pf06_perf_rehearsal.js');
const script=fs.readFileSync('exhibit/pf06_perf_rehearsal.js','utf8');
const page=fs.readFileSync('exhibit/pf06_perf_rehearsal.html','utf8');
const build=fs.readFileSync('exhibit/build.py','utf8');
const runtime=['exhibit/game.js','exhibit/admin.js','exhibit/landing.js',
  'exhibit/index.html','exhibit/modes.html','index.html'];
assert.doesNotMatch(script,/gitai-exhibit-2026|gitai-pages-preview|\blocalStorage\s*[.\[]|fetch\s*\(/,
  'isolated rehearsal must never name/scan a production source');
assert.match(page,/<script src="pf06_perf_rehearsal.js"><\/script>/);
assert.match(page,/id="run"/);
assert.match(page,/id="purge"/);
assert.match(page,/合成データ/);
assert.match(build,/pf06_perf_rehearsal\.html", "pf06_perf_rehearsal\.js"/);
for(const path of runtime){
 const code=fs.readFileSync(path,'utf8');
 assert.ok(!code.includes('pf06_perf_rehearsal.js'),'diagnostic imported by production '+path);
}
const cryptoSource={getRandomValues(array){for(let i=0;i<array.length;i++)array[i]=i+1;return array;}};
const name=api.makeDbName(cryptoSource);
assert.match(name,/^gitailab-pf06-isolated-benchmark-[0-9a-f]{32}$/);
assert.throws(()=>api.assertTestName('gitai-exhibit-2026-user-db'),/試験専用/);
assert.throws(()=>api.makeDbName({}),/安全な試験DB名/);
let urlSeq=0;
const created=[],revoked=[];
const urlApi={
 createObjectURL(blob){assert.ok(blob instanceof Blob);const url='blob:fake-'+(++urlSeq);created.push(url);return url;},
 revokeObjectURL(url){assert.ok(created.includes(url));assert.ok(!revoked.includes(url));revoked.push(url);}
};
const frames=Array.from({length:1000},()=>({image_blob:new Blob(['image'])}));
const windowed=api.createWindow(frames,urlApi);
for(const ix of [0,1,2,500,999,500,0]){
 windowed.seek(ix);
 assert.ok(windowed.stats().active<=5);
}
assert.throws(()=>windowed.seek(1000),/位置/);
windowed.release();
assert.equal(windowed.stats().active,0);
assert.equal(windowed.stats().created,windowed.stats().revoked);
assert.equal(windowed.stats().peak,5);
function mockDom(){
 const body={children:[],appendChild(item){this.children.push(item)}};
 const document={body,createElement(tag){
   return {tag,children:[],dataset:{},setAttribute(){},
     appendChild(item){this.children.push(item)},
     get childElementCount(){return this.children.length},
     remove(){const ix=body.children.indexOf(this);if(ix>=0)body.children.splice(ix,1);}
   };
 }};
 return document;
}
function mockIDB(){
 const existing=new Map(),opened=[],deleted=[],allNames=[];
 const dbFor=name=>({
   closed:false,
   close(){this.closed=true},
   createObjectStore(store){if(!existing.get(name).has(store))existing.get(name).set(store,new Map());},
   transaction(storeNames,mode){
     assert.ok(mode==='readonly'||mode==='readwrite');
     const dbStores=existing.get(name);
     const tx={oncomplete:null,onerror:null,onabort:null,error:null,
       objectStore(store){
         assert.ok(storeNames.includes(store));
         const storage=dbStores.get(store);
         assert.ok(storage);
         return {
           put(value,key){
             assert.equal(mode,'readwrite');
             assert.ok(typeof key==='string');
             storage.set(key,value);
           },
           openCursor(range){
             assert.equal(mode,'readonly');
             const r={result:null,onsuccess:null,error:null};
             const rows=Array.from(storage).filter(([key])=>!range||
               (key>=range.lower&&key<=range.upper)).sort((a,b)=>
                 a[0]<b[0]?-1:a[0]>b[0]?1:0);
             let ix=0;
             function step(){
               if(ix>=rows.length){
                 r.result=null;r.onsuccess();
                 queueMicrotask(()=>tx.oncomplete?.());
                 return;
               }
               const [key,value]=rows[ix++];
               r.result={key,value,continue:()=>queueMicrotask(step)};
               r.onsuccess();
             }
             queueMicrotask(step);
             return r;
           }
         };
       }
     };
     if(mode==='readwrite')queueMicrotask(()=>tx.oncomplete?.());
     return tx;
   }
 });
 const idb={
   open(name,version){
     assert.match(name,/^gitailab-pf06-isolated-benchmark-[0-9a-f]{32}$/);
     assert.equal(version,1);
     opened.push(name);
     const r={result:null,onupgradeneeded:null,onsuccess:null,onerror:null};
     queueMicrotask(()=>{
       if(!existing.has(name))existing.set(name,new Map());
       r.result=dbFor(name);
       r.onupgradeneeded?.();
       r.onsuccess?.();
     });
     return r;
   },
   deleteDatabase(name){
     assert.match(name,/^gitailab-pf06-isolated-benchmark-[0-9a-f]{32}$/);
     deleted.push(name);
     const r={onsuccess:null,onerror:null};
     queueMicrotask(()=>{existing.delete(name);r.onsuccess?.()});
     return r;
   },
   async databases(){
     return [...existing.keys(), 'gitai-exhibit-2026-important-run']
       .map(name=>({name}));
   }
 };
 return {idb,existing,opened,deleted};
}
const keyRange={bound:(lower,upper)=>({lower,upper})};
(async()=>{
 for(const count of [100,1000]){
   const m=mockIDB(),doc=mockDom();
   let tick=0;
   const report=await api.run({
     count,indexedDB:m.idb,IDBKeyRange:keyRange,crypto:cryptoSource,
     now:()=>++tick,urlApi,document:doc,onPhase:()=>{}
   });
   assert.equal(report.test_size,count);
   assert.equal(report.records_per_store,count);
   assert.equal(report.theater_peak_object_urls,5);
   assert.equal(report.theater_url_leaks,0);
   assert.equal(report.specimen_initial_cards,30);
   assert.equal(report.cleanup_completed,true);
   assert.equal(report.synthetic_only,true);
   assert.equal(report.source_db_access,false);
   assert.equal(report.device_memory_mb,null);
   assert.equal(report.image_decode_tested,false);
   assert.equal(report.real_game_performance_tested,false);
   assert.ok(report.duration_ms.theater_read_sort_ms>=0);
   assert.equal(doc.body.children.length,0);
   assert.equal(m.opened.length,1);
   assert.deepEqual(m.deleted,m.opened);
   assert.equal(m.existing.size,0);
 }
 const m=mockIDB();
 const orphan=api.makeDbName(cryptoSource);
 m.existing.set(orphan,new Map());
 assert.equal(await api.purgeOrphans(m.idb),1);
 assert.deepEqual(m.deleted,[orphan]);
 assert.equal(m.existing.size,0);
 console.log('PF06: opt-in 100/1000 synthetic rehearsal, readonly scans, <=5 URLs, 30 DOM cards, cleanup and production DB isolation OK.');
})().catch(error=>{console.error(error);process.exitCode=1;});
