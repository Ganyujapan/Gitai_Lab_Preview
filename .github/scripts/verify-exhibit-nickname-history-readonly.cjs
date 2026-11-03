'use strict';
// Execute the actual exhibition theater readMode() with 1000 saved frame
// keys and 200 visitor names. All data is synthetic; no IndexedDB connects.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const script=fs.readFileSync('exhibit/theater_canvas_20261026.js','utf8');
const a=script.indexOf('  async function readMode(mode) {');
const b=script.indexOf('  function numberOf(generation) {',a);
assert.ok(a>0&&b>a,'shipped readMode must be tested, not a duplicate');
const code=script.slice(a,b);
const PREFIX='exhibit_visitor_nickname_v1:';
const id=n=>'gen'+String(n).padStart(5,'0');
const imageKeys=Array.from({length:1000},(_,i)=>id(1000-i));
const names=Array.from({length:200},(_,i)=>{
 const start=i*5+1,end=start+4;
 return {key:PREFIX+id(end),value:{schema:1,start,end,name:'参加者'+(i+1)}};
});
const invalidNames=[
 {key:PREFIX+'bad1',value:{schema:1,start:11,end:19,name:'長すぎる範囲'}},
 {key:PREFIX+'bad2',value:{schema:2,start:1,end:1,name:'旧形式'}},
 {key:PREFIX+'bad3',value:{schema:1,start:0,end:1,name:'不正'}},
 {key:PREFIX+'bad4',value:{schema:1,start:3,end:3,name:'<script>'}},
 {key:PREFIX+'bad5',value:{schema:1,start:11,end:10,name:'逆順'}}
];
const sources={
 warning:{generation:id(1001),frames:imageKeys,records:[
  {key:'current_generation_id',value:id(1001)},
  {key:'genome:'+id(1001)+':01',value:{shouldNotBeRead:true}},
  ...names,...invalidNames
 ]},
 cryptic:{generation:id(31),frames:[id(30)],records:[
  {key:'current_generation_id',value:id(31)},
  {key:PREFIX+id(30),value:{schema:1,start:26,end:30,name:'カモフラージュ'}}
 ]}
};
const stats={transactions:[],blobReads:0,unscopedMetaReads:0,scopedMetaReads:0,closed:[]};
function fakeDb(dbName){
 const source=sources[dbName];
 if(!source)return null;
 return {
  close(){stats.closed.push(dbName)},
  objectStoreNames:{contains:s=>s==='meta'||s==='theater_frames'},
  transaction(stores,mode){
   assert.equal(mode,'readonly','reading theater must NEVER write');
   assert.deepEqual(Array.from(stores),['meta','theater_frames']);
   stats.transactions.push({dbName,mode});
   let outstanding=0,completed=false;
   const tx={
    objectStore(store){
     if(store==='meta'){
      return {
       get(key){
        assert.equal(key,'current_generation_id');
        const req={};schedule(()=>{req.result=source.generation;req.onsuccess?.()});
        return req;
       },
       openCursor(range){
        assert.equal(range.lower,PREFIX);
        assert.equal(range.upper,PREFIX+'\uffff');
        stats.scopedMetaReads++;
        const selected=source.records.filter(item=>
          item.key>=range.lower&&item.key<=range.upper).sort((x,y)=>
            x.key<y.key?-1:x.key>y.key?1:0);
        let index=0;
        const req={};
        function pump(){schedule(()=>{
         const item=selected[index++];
         req.result=item?{key:item.key,value:item.value,continue:pump}:null;
         req.onsuccess?.();
        })}
        pump();return req;
       }
      };
     }
     if(store==='theater_frames'){
      return {
       openKeyCursor(){
        let index=0;const req={};
        function pump(){schedule(()=>{
          const key=source.frames[index++];
          req.result=key?{key,continue:pump}:null;
          req.onsuccess?.();
        })}
        pump();return req;
       },
       get(){
        stats.blobReads++;
        throw Error('Theater must not read full frame blobs while listing history');
       },
       openCursor(){
        stats.blobReads++;
        throw Error('Theater must open a KEY-only cursor');
       }
      };
     }
     throw Error('Unexpected store: '+store);
    }
   };
   function schedule(work){
    outstanding++;
    queueMicrotask(()=>{
     work();
     outstanding--;
     if(!outstanding&&!completed){
      completed=true;
      queueMicrotask(()=>tx.oncomplete?.());
     }
    });
   }
   return tx;
  }
 };
}
const context={
 openExisting:async(db)=>fakeDb(db),
 NAME_PREFIX:PREFIX,IDBKeyRange:{bound:(lower,upper)=>({lower,upper})},
 Number,String,Object,Array,Error
};
vm.runInNewContext(code+'\nglobalThis.testReadMode=readMode;',context,{
 filename:'exhibit/theater_canvas_20261026.js:history',timeout:3000
});
(async()=>{
 const h=await context.testReadMode({db:'warning'});
 assert.equal(h.generation,id(1001));
 assert.equal(h.frames.length,1000);
 assert.equal(h.frames[0].generation_id,id(1));
 assert.equal(h.frames[999].generation_id,id(1000));
 assert.equal(h.nicknames.length,200,'invalid records excluded');
 assert.equal(h.nicknames[0].name,'参加者1');
 assert.equal(h.nicknames[0].start,1);
 assert.equal(h.nicknames[199].name,'参加者200');
 assert.equal(h.nicknames[199].end,1000);
 const byGeneration=n=>h.nicknames.find(item=>n>=item.start&&n<=item.end)?.name;
 assert.equal(byGeneration(1),'参加者1');
 assert.equal(byGeneration(500),'参加者100');
 assert.equal(byGeneration(501),'参加者101');
 assert.equal(byGeneration(1000),'参加者200');
 const cryptic=await context.testReadMode({db:'cryptic'});
 assert.equal(cryptic.frames.length,1);
 assert.equal(cryptic.nicknames.length,1);
 assert.equal(cryptic.nicknames[0].name,'カモフラージュ');
 assert.ok(!cryptic.nicknames.some(x=>x.name==='参加者1'),
  'modes must never share participant names');
 const missing=await context.testReadMode({db:'absent-mode'});
 assert.equal(missing.generation,null);
 assert.equal(missing.frames.length,0);
 assert.equal(missing.nicknames.length,0);
 assert.equal(stats.blobReads,0);
 assert.equal(stats.unscopedMetaReads,0);
 assert.equal(stats.scopedMetaReads,2);
 assert.deepEqual(stats.closed,['warning','cryptic']);
 assert.equal(stats.transactions.length,2);
 console.log('Exhibition 1000-frame/200-nickname historical read: sorted generation keys, prefix-only metadata, invalid-name filtering, mode isolation, no blobs/writes and closed DB OK.');
})().catch(e=>{console.error(e);process.exitCode=1});
