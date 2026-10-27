'use strict';
// EV-03: run the real generation codecs and IDB readers across gen99999 -> gen100000.
// This test never touches a browser's real IndexedDB or saved data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const paths = [
  'js/pages_preview.js', 'js/experiment_saves.js', 'index.html',
  'exhibit/admin.js', 'exhibit/game.js', 'exhibit/theater_canvas_20261026.js'
];
const docs = new Map(paths.map(path => [path,fs.readFileSync(path,'utf8')]));
const oldPattern=String.raw`/^gen\d{5}$/`;
const canonical=String.raw`/^gen(?:\d{5}|[1-9]\d{5,})$/`;
function slice(source, startMark, endMark) {
 const start=source.indexOf(startMark),end=source.indexOf(endMark,start);
 assert.ok(start>=0&&end>start,'cannot extract real function: '+startMark);
 return source.slice(start,end);
}
for(const [path,src] of docs){
 assert.ok(src.includes(canonical),'expected production regex not found in '+path);
 assert.ok(!src.includes(oldPattern),'five-digit cap still present in '+path);
 const literal=vm.runInNewContext('('+canonical+')',{});
 for(const id of ['gen00001','gen99998','gen99999','gen100000','gen100001','gen1234567']) {
   assert.equal(literal.test(id),true,path+':'+id);
 }
 for(const id of ['gen0001','gen123456','gen0100000','genabcde','gen-99999','gen12345abc','gen']) {
   assert.equal(literal.test(id),id==='gen123456',path+':'+id);
 }
}
const pages=docs.get('js/pages_preview.js');
const numeric=slice(pages,'  function nextGenerationId(', '\n  function rgbToHsv(');
const p={};vm.runInNewContext(numeric+'\nglobalThis.nextId=nextGenerationId;',p);
assert.equal(p.nextId('gen99998'),'gen99999');
assert.equal(p.nextId('gen99999'),'gen100000');
assert.equal(p.nextId('gen100000'),'gen100001');
const saver=slice(pages,'  function completedRunKey(', '\n  async function commitEvolutionGeneration(');
const current={META_STORE:'meta',idbGet:async (_store,key)=>
 key==='completed_run:run-1'?
 {generation_id:'gen99999',next_generation_id:'gen100000'}:
 key==='completed_run:run-2'?
 {generation_id:'gen100000',next_generation_id:'gen100001'}:null};
vm.runInNewContext(saver+'\nglobalThis.replay=persistedCompletedRun;',current);
(async()=>{
 assert.equal((await current.replay('run-1')).next_generation_id,'gen100000');
 assert.equal((await current.replay('run-2')).next_generation_id,'gen100001');
 const saves=docs.get('js/experiment_saves.js');
 const show=slice(saves,'  function displayGeneration(', '\n  function openDatabase(');
 const g={};
 vm.runInNewContext(show+'\nglobalThis.display=displayGeneration;',g);
 assert.equal(g.display('gen99999'),'第99999世代');
 assert.equal(g.display('gen100000'),'第100000世代');
 assert.equal(g.display('gen100001'),'第100001世代');
 assert.equal(g.display('gen00001'),'第1世代');
 assert.equal(g.display('gen0100000'),'世代不明');

 const getSaved=slice(saves,'  async function storedGeneration(', '\n  // Experiment controls',);
 function fakeDB(gen) {
   let closed=0;
   const db={objectStoreNames:{contains:()=>true},close(){closed++;},
     transaction(name,mode){
       assert.equal(name,'meta');assert.equal(mode,'readonly');
       return {objectStore(store){assert.equal(store,'meta');return {get(key){
         assert.equal(key,'current_generation_id');
         const req={result:gen};queueMicrotask(()=>req.onsuccess?.());return req;
       }}}};
     }};
   return {db,closed:()=>closed};
 }
 const db={};const ctx={openDatabase:async()=>db.current.db};
 vm.runInNewContext(getSaved+'\nglobalThis.getSaved=storedGeneration;',ctx);
 for(const gen of ['gen99999','gen100000','gen100001','gen00001']) {
   db.current=fakeDB(gen);
   assert.equal(await ctx.getSaved('existing-db'),gen);
   assert.equal(db.current.closed(),1);
 }
 for(const gen of ['gen0000','gen0100000']) {
   db.current=fakeDB(gen);
   await assert.rejects(ctx.getSaved('existing-db'),/世代情報/);
   assert.equal(db.current.closed(),1);
 }

 const html=docs.get('index.html');
 const currentFn=slice(html,'  async function fetchCurrentGeneration()', '\n  async function preloadAssets(');
 const fetchCtx={fetch:async()=>({ok:true,json:async()=>({current_generation_id:'gen100000'})})};
 vm.runInNewContext(currentFn+'\nglobalThis.getCurrent=fetchCurrentGeneration;',fetchCtx);
 assert.equal(await fetchCtx.getCurrent(),'gen100000');
 fetchCtx.fetch=async()=>({ok:true,json:async()=>({current_generation_id:'gen0100000'})});
 await assert.rejects(fetchCtx.getCurrent(),/世代IDが不正/);

 // The saved theater's historical order must remain numeric at the boundary.
 const theater=docs.get('exhibit/theater_canvas_20261026.js');
 assert.match(theater,/Number\(a\.generation_id\.slice\(3\)\)\s*-\s*Number\(b\.generation_id\.slice\(3\)\)/);
 const ids=['gen100000','gen99998','gen100001','gen99999','gen00001'];
 assert.deepEqual(ids.slice().sort((a,b)=>Number(a.slice(3))-Number(b.slice(3))),[
   'gen00001','gen99998','gen99999','gen100000','gen100001'
 ]);
 const admin=docs.get('exhibit/admin.js');
 assert.match(admin,/currentGeneration:\s*current/);
 assert.match(admin,/current\s*!==\s*body\.currentGeneration/);
 assert.match(pages,/commitEvolutionGeneration\(/);
 console.log('EV-03: gen99998-100001: next generation, durable replay, stored save, top-page validation, theater numeric history, exhibition import ID all compatible.');
})().catch(error=>{console.error(error);process.exitCode=1;});
