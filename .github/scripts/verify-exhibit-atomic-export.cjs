'use strict';
// EXH-F02: verify export reads images/genomes/pointer/theater in a single
// readonly IDB transaction before asynchronous backup encoding begins.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('exhibit/admin.js','utf8');
const start=source.indexOf('  function snapshotStores(');
const end=source.indexOf('\n  function encode64(',start);
const expStart=source.indexOf('  async function exportMode(');
const expEnd=source.indexOf('\n  // Existing export encoding',expStart);
assert.ok(start>0 && end>start && expStart>0 && expEnd>expStart);
const snapshotSource=source.slice(start,end);
const exportSource=source.slice(expStart,expEnd);
assert.match(exportSource,/snapshot = await snapshotStores\(db\)/);
assert.match(exportSource,/finally \{ db\.close\(\); \}/);
assert.ok(exportSource.indexOf('snapshot = await snapshotStores(db)') <
          exportSource.indexOf('await encode(item.value)'));
assert.doesNotMatch(exportSource,/await readStore\(/);
const STORES=['images','meta','theater_frames'];
const ctx={STORES};
vm.runInNewContext(snapshotSource+'\nglobalThis.takeSnapshot=snapshotStores;',ctx,{
  filename:'exhibit/admin.js:EXH-F02',timeout:4000
});
const clone=map=>new Map([...map.entries()]);
function fakeDb({abort=false,throwCursor=false}={}){
 const records={
   images:new Map([['gen00042:01','old-png']]),
   meta:new Map([['current_generation_id','gen00042'],['genome:gen00042:01','old-genome']]),
   theater_frames:new Map([['gen00042','old-frame']])
 };
 const transactions=[];
 const db={records,
   transaction(names,mode){
     assert.deepEqual(Array.from(names),STORES,'all stores must be one transaction');
     assert.equal(mode,'readonly');
     const frozen=Object.fromEntries(STORES.map(n=>[n,clone(records[n])]));
     let inFlight=STORES.length,completeCalled=false;
     const tx={
       mode,abort(){queueMicrotask(()=>tx.onabort?.());},
       objectStore(name){
         return {openCursor(){
           if(throwCursor)throw Error('cursor unavailable');
           const items=[...frozen[name].entries()];
           let pos=0;
           const req={result:null,onsuccess:null};
           function deliver(){
             if(abort){tx.onabort?.();return;}
             if(pos<items.length){
               const [key,value]=items[pos++];
               req.result={key,value,continue(){queueMicrotask(deliver);}};
               req.onsuccess?.();
             }else{
               req.result=null;req.onsuccess?.();
               inFlight--;
               if(!inFlight && !completeCalled){
                 completeCalled=true;
                 queueMicrotask(()=>tx.oncomplete?.());
               }
             }
           }
           queueMicrotask(deliver);
           return req;
         }};
       }
     };
     transactions.push(tx);return tx;
   }
 };
 return {db,transactions};
}
(async()=>{
 const {db,transactions}=fakeDb();
 const before=ctx.takeSnapshot(db);
 // Simulate a new generation write between queued cursor callbacks.
 db.records.images.clear();
 db.records.images.set('gen00043:01','new-png');
 db.records.meta.set('current_generation_id','gen00043');
 db.records.meta.set('genome:gen00043:01','new-genome');
 db.records.theater_frames.clear();
 db.records.theater_frames.set('gen00043','new-frame');
 const result=await before;
 assert.equal(transactions.length,1,'exactly one readonly transaction');
 assert.deepEqual(Array.from(result.images,entry=>entry.key),['gen00042:01']);
 assert.equal(result.images[0].value,'old-png');
 assert.equal(result.meta.find(x=>x.key==='current_generation_id').value,'gen00042');
 assert.equal(result.meta.find(x=>x.key==='genome:gen00042:01').value,'old-genome');
 assert.equal(result.theater_frames[0].value,'old-frame');
 const failed=fakeDb({abort:true});
 await assert.rejects(ctx.takeSnapshot(failed.db));
 const synchronous=fakeDb({throwCursor:true});
 await assert.rejects(ctx.takeSnapshot(synchronous.db),/cursor unavailable/);
 // Does not rename databases, mutate records, or alter backup schema.
 assert.match(source,/const STORES = \['images', 'meta', 'theater_frames'\]/);
 assert.match(source,/const BACKUP_SCHEMA = 'gitai-exhibit-backup-v1'/);
 console.log('EXH-F02: one-transaction three-store snapshot survives interleaved writes; abort and synchronous cursor errors reject.');
})().catch(error=>{console.error(error);process.exitCode=1;});
