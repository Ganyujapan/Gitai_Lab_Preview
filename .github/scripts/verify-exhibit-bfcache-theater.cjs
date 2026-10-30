'use strict';
// RE2-PF-02: execute actual pagehide/pageshow handlers against deterministic
// BFCache event fixtures (persisted true/false). Real Safari remains untested.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('exhibit/theater_canvas_20261026.js','utf8');
const a=source.indexOf("  window.addEventListener('pagehide',"),b=source.indexOf("  document.addEventListener('visibilitychange',",a);
assert.ok(a>0&&b>a);
const handlers=source.slice(a,b);
assert.match(handlers,/event\.persisted/);
assert.match(handlers,/assignFrameUrls\(\)/);
assert.match(handlers,/openTheater\(activeMode, handoverData\)/);
function fixture({visible=true,frames=3,handover=false,finished=false}={}){
 const listeners={};
 const calls=[];
 const ctx={
  window:{addEventListener(type,fn){listeners[type]=fn;}},
  dialog:{hidden:!visible},activeMode:'warning',
  frames:Array.from({length:frames},(_,i)=>({generation_id:'gen'+String(i+21).padStart(5,'0')})),
  frameUrls:Array.from({length:frames},(_,i)=>'blob:old-'+i),
  cursor:Math.max(0,frames-1),token:3,finalTimer:42,
  handoverData:handover?{mode:'warning',start:21,end:25}:null,
  handoverFinished:{hidden:!handover},
  playback:handover&&!finished?42:null,
  resumeHandoverOnPageshow:false,
  stopPlayback:()=>{calls.push('stop');ctx.playback=null;},
  releaseImage:()=>{calls.push('release');ctx.frameUrls=[];},
  clearTimeout:id=>calls.push('clear:'+id),
  refreshGenerations:async()=>calls.push('refresh'),
  assignFrameUrls:()=>{calls.push('assign');ctx.frameUrls=ctx.frames.map((_,i)=>'blob:new-'+i);},
  showFrame(index){calls.push('paint:'+index);},
  scheduleHandoverPlayback(){calls.push('handover-play');},
  openTheater(mode,data){calls.push('reload:'+mode+':'+(data?.start||'none'));return Promise.resolve()}
 };
 vm.runInNewContext(handlers,ctx,{filename:'exhibit/theater_canvas_20261026.js:BFCache',timeout:3000});
 return {ctx,calls,emit:(name,event={})=>listeners[name](event)};
}
const ready=fixture();
ready.emit('pagehide');
assert.equal(ready.ctx.token,4);
assert.equal(ready.ctx.finalTimer,null);
assert.equal(ready.ctx.frameUrls.length,0);
ready.emit('pageshow',{persisted:true});
assert.equal(ready.calls.filter(x=>x==='assign').length,1);
assert.equal(ready.calls.filter(x=>x==='paint:2').length,1);
assert.equal(ready.ctx.frameUrls.length,3);
ready.emit('pageshow',{persisted:true});
assert.equal(ready.calls.filter(x=>x==='assign').length,1,'no duplicate object URLs');
const normal=fixture();
normal.emit('pageshow',{persisted:false});
assert.equal(normal.calls.filter(x=>x==='assign').length,0);
const closed=fixture({visible:false});
closed.emit('pagehide');closed.emit('pageshow',{persisted:true});
assert.equal(closed.calls.filter(x=>x==='assign').length,0);
const opening=fixture({frames:0,handover:true});
opening.emit('pagehide');opening.emit('pageshow',{persisted:true});
assert.ok(opening.calls.includes('reload:warning:21'),'pending query is restarted with handover');
assert.equal(opening.calls.some(x=>x.startsWith('paint:')),false);
const ended=fixture({handover:true,finished:true});
ended.emit('pagehide');ended.emit('pageshow',{persisted:true});
assert.equal(ended.calls.filter(x=>x==='paint:2').length,1);
assert.equal(ended.calls.includes('handover-play'),false,'finished handover must not restart');
const playing=fixture({handover:true,finished:false});
playing.emit('pagehide');playing.emit('pageshow',{persisted:true});
assert.ok(playing.calls.includes('handover-play'),'unfinished handover resumes');
assert.doesNotMatch(handlers,/idbPut|transaction\(|clear\(\)/);
console.log('RE2-PF-02: simulated BFCache reopened frames, in-flight readonly restore, one-use handover and no duplicate URLs OK.');
