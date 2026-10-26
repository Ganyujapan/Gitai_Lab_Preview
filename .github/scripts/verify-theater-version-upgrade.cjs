'use strict';
// PF03: exercise the real theater refresh function against shared version logic.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const theater=require('../../js/theater_scale.js');
const source=fs.readFileSync('index.html','utf8');
const start=source.indexOf('  async function refreshSavedTheaterFrame(');
const end=source.indexOf('\n  async function upgradeSavedTheaterFramesInBackground(',start);
assert.ok(start>0 && end>start);
assert.equal(theater.VERSION,2);
assert.equal(theater.WARNING_VERSION,3);
const actual=source.slice(start,end);
assert.match(actual,/GitaiTheaterScale\.needsRebuild\(\{\s*\.\.\.frame,\s*render_version: result\.render_version/);
function harness({id,oldVersion,resultVersion,missing=false,delay=false}){
 const warning=id.startsWith('warning_color_');
 const frame={generation_id:'gen00021',preview_run_id:id,render_version:oldVersion,
   object_url:'blob:previous'};
 const state={theaterFrames:[frame],theaterObjectUrls:[frame.object_url]};
 const created=[],revoked=[];
 let resolvePending,attempts=0;
 const context={
   state,theaterFrameJobs:new Map(),
   window:{GitaiTheaterScale:theater,GitaiPagesPreview:{
     async ensureTheaterSnapshot(){
       attempts++;
       if(delay) await new Promise(resolve=>resolvePending=resolve);
       return missing?null:{
         render_version:resultVersion,image_blob:new Blob(['png-result']),
       };
     }
   }},
   URL:{
     createObjectURL(blob){
       assert.ok(blob instanceof Blob);
       const url='blob:replacement-'+(created.length+1);
       created.push(url);
       return url;
     },
     revokeObjectURL(url){revoked.push(url);}
   },
   Blob,
 };
 vm.runInNewContext(actual+'\nglobalThis.refresh=refreshSavedTheaterFrame;',context,
   {filename:'index.html:refreshSavedTheaterFrame',timeout:3000});
 return {frame,state,created,revoked,warning,get attempts(){return attempts;},
   refresh:()=>context.refresh(frame),release:()=>resolvePending?.()};
}
(async()=>{
  for(const [id,oldVersion,nextVersion] of [
    ['konchu2026_cryptic',1,2],
    ['warning_color_fog_v2',1,3],
    ['warning_color_fog_v2',2,3]
  ]){
    const h=harness({id,oldVersion,resultVersion:nextVersion});
    assert.equal(await h.refresh(),true);
    assert.equal(h.frame.render_version,nextVersion);
    assert.deepEqual(h.revoked,['blob:previous']);
    assert.equal(h.state.theaterObjectUrls.length,1);
    assert.equal(h.frame.object_url,h.created[0]);
    assert.equal(h.attempts,1);
    assert.equal(await h.refresh(),true,'current frame not rebuilt twice');
    assert.equal(h.attempts,1);
  }
  const current=harness({id:'warning_color_fog_v2',oldVersion:3,resultVersion:3});
  assert.equal(await current.refresh(),true);
  assert.equal(current.attempts,0);
  assert.equal(current.created.length,0);
  const missing=harness({id:'warning_color_fog_v2',oldVersion:1,resultVersion:3,missing:true});
  assert.equal(await missing.refresh(),false);
  assert.equal(missing.frame.object_url,'blob:previous');
  assert.deepEqual(missing.revoked,[]);
  const future=harness({id:'warning_color_fog_v2',oldVersion:2,resultVersion:4});
  assert.equal(await future.refresh(),false,'future unknown rendering version rejected');
  assert.equal(future.frame.render_version,2);
  assert.equal(future.created.length,0);
  const stale=harness({id:'warning_color_fog_v2',oldVersion:2,resultVersion:3,delay:true});
  const waiting=stale.refresh();
  stale.state.theaterFrames=[];
  stale.release();
  assert.equal(await waiting,false);
  assert.equal(stale.created.length,0,'closed/replaced session creates no URL');
  assert.equal(stale.frame.object_url,'blob:previous');
  console.log('PF03: cryptic v1→2, warning v1/v2→3, missing PNG, current/future version and stale session OK.');
})().catch(error=>{console.error(error);process.exitCode=1;});
