'use strict';
// RE2-STO-01: execute the REAL subscriber update and records display functions
// with controlled Promise completion. No user's IDB or localStorage is opened.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const registrySrc=fs.readFileSync('js/experiment_registry.js','utf8');
const savesSrc=fs.readFileSync('js/experiment_saves.js','utf8');
function extract(src,a,b){
 const i=src.indexOf(a),j=src.indexOf(b,i);
 assert.ok(i>=0&&j>i,'missing boundary: '+a);
 return src.slice(i,j);
}
const setCache=extract(registrySrc,'  function setCache(', '  function startTransaction(');
const regCtx={cache:[],revision:-1,subscribers:new Set(),console,validateRecords(records){
  assert.ok(Array.isArray(records) && records.length<=10);
}};
let notifications=0,lastRecords=null;
regCtx.subscribers.add(records=>{notifications++;lastRecords=records;});
vm.runInNewContext(setCache+'\nglobalThis.update=setCache;',regCtx,{timeout:5000});
regCtx.update({version:2,revision:0,records:[]});
assert.equal(notifications,1,'new registry initializes subscriber exactly once');
for(let i=0;i<100;i++)regCtx.update({version:2,revision:0,records:[]});
assert.equal(notifications,1,'100 same-revision notifications must not emit events');
regCtx.update({version:2,revision:1,records:[{id:'1',config:{}}]});
assert.equal(notifications,2,'new revision triggers one subscriber event');
assert.equal(lastRecords.length,1);
regCtx.update({version:2,revision:0,records:[]});
assert.equal(notifications,2,'older revision cannot overwrite latest registry state');
assert.equal(regCtx.cache.length,1);

function deferred(){
 let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});
 return {promise,resolve,reject};
}
function fixture(){
 let openings=0,clears=0,updates=0;
 const reads=[];
 const entries={children:[],replaceChildren(){clears++;this.children=[]},
   appendChild(item){this.children.push(item)}};
 const dialog={hidden:false};
 const close={textContent:''};
 const ctx={
   busy:false,recordsRequestSerial:0,dialog,close,entries,
   heading:{textContent:'実験記録'},summary:{textContent:''},
   registry:{refresh(){const d=deferred();reads.push(d);return d.promise}},
   readRegistry:()=>[],
   document:{createElement:tag=>({tagName:tag,className:'',textContent:''})},
   openModal(){openings++;dialog.hidden=false;},
   updateCounter(){updates++},
   console
 };
 const closeSource=extract(savesSrc,'  function closeModal()', '  async function perform(');
 const displaySource=extract(savesSrc,'  async function showRecords()', '  // A registry initialization/migration error');
 vm.runInNewContext(closeSource+'\n'+displaySource+
   '\nglobalThis.display=showRecords;globalThis.closeRecords=closeModal;',
   ctx,{timeout:5000});
 return {ctx,reads,entries,dialog,
   get openings(){return openings},get clears(){return clears},get updates(){return updates},
   display:()=>ctx.display(),close:()=>ctx.closeRecords()};
}
(async()=>{
 const f=fixture();
 const old=f.display(),newer=f.display();
 assert.equal(f.reads.length,2);
 f.reads[1].resolve();await newer;
 f.reads[0].resolve();await old;
 assert.equal(f.openings,1,'older response cannot open or paint twice');
 assert.equal(f.entries.children.length,1,'empty records message shown once');
 const stale=f.display();
 f.close();
 assert.equal(f.dialog.hidden,true);
 f.reads[2].resolve();await stale;
 assert.equal(f.dialog.hidden,true,'closed modal must not reopen from stale refresh');
 assert.equal(f.openings,1);
 const reopened=f.display();f.reads[3].resolve();await reopened;
 assert.equal(f.openings,2,'user can explicitly reopen after close');

 const failing=fixture();
 const pending=failing.display();
 failing.close();
 failing.reads[0].reject(Error('stale DB failure'));
 await pending;
 assert.equal(failing.openings,0,'failed stale refresh cannot reopen dialog');
 // Registry data and old v1 migration are untouched; no save writes here.
 assert.doesNotMatch(setCache,/objectStore\(|\.put\(/);
 console.log('RE2-STO-01: 100 same-revision reads converge, real modal ignores old success/failure and remains reopenable.');
})().catch(e=>{console.error(e);process.exitCode=1});
