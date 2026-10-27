'use strict';
// STO-04: execute the actual read-only submission status query with an
// isolated persistence stub. A missing marker is UNKNOWN, never "failed".
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync('js/pages_preview.js','utf8');
const start=src.indexOf('  async function readSubmissionStatus(');
const end=src.indexOf('  async function commitEvolutionGeneration(',start);
assert.ok(start>0&&end>start,'real read-only query code not found');
const actual=src.slice(start,end);
assert.match(src,/path\.endsWith\('\/api\/run_status'\)/);
assert.match(src,/await readSubmissionStatus\(runId\)/);
assert.doesNotMatch(actual,/idbPut\(|commitEvolutionGeneration|evolveGeneration\(|clearDb\(/);
function fixture({committed=null,pointer='gen00021',event=null,throwEvent=false}={}){
 const reads=[],events=[],ctx={META_STORE:'meta',
  async persistedCompletedRun(id){reads.push(['completed',id]);return committed;},
  async idbGet(store,key){reads.push(['pointer',store,key]);return pointer;},
  async entertainmentMutationEvent(from,to){
    events.push([from,to]);
    if(throwEvent)throw Error('visual only');
    return event;
  },
  console:{warn:()=>{}}
 };
 vm.runInNewContext(actual+'\nglobalThis.inspect=readSubmissionStatus;',ctx,{
   filename:'js/pages_preview.js:STO-04-status',timeout:3000});
 return {run:id=>ctx.inspect(id),reads,events};
}
(async()=>{
 const waiting=fixture();
 const result=await waiting.run('run-21-unique');
 assert.equal(result.status,'unconfirmed');
 assert.equal(result.current_generation_id,'gen00021');
 assert.equal(result.next_generation_id,undefined);
 assert.equal(waiting.events.length,0);
 assert.equal(waiting.reads.length,2);
 const finished=fixture({
  committed:{generation_id:'gen00021',next_generation_id:'gen00022'},
  pointer:'gen00022',
  event:{type:'special_mutation'}
 });
 const good=await finished.run('run-21-unique');
 assert.equal(good.status,'committed');
 assert.equal(good.generation_id,'gen00021');
 assert.equal(good.next_generation_id,'gen00022');
 assert.equal(good.entertainment_event.type,'special_mutation');
 assert.equal(finished.events.length,1);
 const silent=fixture({
  committed:{generation_id:'gen00021',next_generation_id:'gen00022'},
  pointer:'gen00022',
  throwEvent:true
 });
 const saved=await silent.run('run-21-unique');
 assert.equal(saved.status,'committed','visualization failure cannot erase confirmed commit');
 assert.equal(saved.entertainment_event,null);
 const changedPointer=fixture({pointer:'gen00023'});
 assert.equal((await changedPointer.run('run-stale')).status,'unconfirmed',
  'a moved pointer alone is not proof that this run was committed');
 console.log('STO-04: durable submitted run status proves exact run-ID commit or stays unknown; no writes, no duplicate evolution.');
})().catch(err=>{console.error(err);process.exitCode=1});
