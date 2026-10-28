'use strict';
// SFX-L02: execute the shipped SFX module with synthetic touch gestures and
// deferred AudioContext.resume. No soundcard, network or real browser storage.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('js/game_sfx.js','utf8');
async function scenario(kind){
 let time=1000,random=0,hidden=false;
 const events=new Map(),buffers=[],native=[],resumes=[];
 let context=null;
 const FakeDate=class extends Date {static now(){return time}};
 const document={
  get hidden(){return hidden;},
  createElement:()=>({canPlayType:()=>'',preload:'',src:'',volume:1,
    load(){},pause(){},addEventListener(){},removeEventListener(){},
    play(){native.push({time,src:this.src});return Promise.resolve()}}),
  addEventListener(name,cb){const ar=events.get(name)||[];ar.push(cb);events.set(name,ar)}
 };
 class TestContext{
  constructor(){context=this;this.state='running';this.currentTime=1;this.destination={};this.events={}}
  createDynamicsCompressor(){return {threshold:{},knee:{},ratio:{},attack:{},release:{},connect(){}}}
  createBufferSource(){return {buffer:null,connect(){},stop(){},disconnect(){},
    start(){buffers.push({time,path:this.buffer.path})}}}
  createGain(){return {gain:{},connect(){},disconnect(){}}}
  decodeAudioData(bytes){return Promise.resolve({path:bytes.path})}
  addEventListener(name,cb){this.events[name]=cb}
  resume(){return new Promise((resolve,reject)=>resumes.push({
   ok:()=>{this.state='running';resolve()},
   fail:()=>{this.state='suspended';reject(new Error('NotAllowedError'))}
  }))}
 }
 const window={navigator:{maxTouchPoints:5,userAgent:'iPad Safari',platform:'MacIntel'},
  location:{search:'?sfx=fast'},AudioContext:TestContext,PointerEvent:function(){},
  crypto:{getRandomValues(a){a[0]=random++;return a}},
  fetch:async path=>({ok:true,arrayBuffer:async()=>({path})})};
 vm.runInNewContext(source,{window,document,Date:FakeDate,Promise,Uint32Array,Map,
  Set,Object,Math,Array,console},{filename:'game_sfx.js:SFX-L02',timeout:3000});
 await window.GitaiGameSfx.prepare();
 function emit(name,fields={}){
  for(const cb of events.get(name)||[])cb({type:name,pointerId:7,isTrusted:true,...fields});
 }
 function tap(){
  emit('pointerdown');
  window.GitaiGameSfx.play('capture');
  emit('pointerup');
 }
 function visibility(state){hidden=state;emit('visibilitychange')}
 assert.equal(context?.state,'running');
 if(kind==='late_success'||kind==='late_failure'){
  tap();assert.equal(resumes.length,1);
  time+=5000;
  if(kind==='late_success')resumes.shift().ok();else resumes.shift().fail();
  await Promise.resolve();await Promise.resolve();
  assert.equal(buffers.length,0);
  assert.equal(native.length,0,'stale resume must not play native fallback');
 } else if(kind==='hide_success'||kind==='hide_failure'){
  tap();assert.equal(resumes.length,1);
  visibility(true);visibility(false);
  if(kind==='hide_success')resumes.shift().ok();else resumes.shift().fail();
  await Promise.resolve();await Promise.resolve();
  assert.equal(buffers.length,0);assert.equal(native.length,0);
 } else if(kind==='cancel'){
  tap();emit('pointercancel');resumes.shift().ok();
  await Promise.resolve();await Promise.resolve();
  assert.equal(buffers.length,0);assert.equal(native.length,0);
 } else if(kind==='newer_tap'){
  tap();
  time+=20;
  tap();
  assert.equal(resumes.length,2);
  const first=resumes.shift(),second=resumes.shift();
  first.ok();await Promise.resolve();await Promise.resolve();
  assert.equal(buffers.length,0,'old tap must not overtake newer tap');
  second.ok();await Promise.resolve();await Promise.resolve();
  assert.equal(buffers.length,1);
  assert.equal(native.length,0);
 } else if(kind==='quick_success'){
  tap();assert.equal(resumes.length,1);
  time+=30;resumes.shift().ok();
  await Promise.resolve();await Promise.resolve();
  assert.equal(buffers.length,1);
  assert.equal(native.length,0);
  time+=20;emit('pointerdown');window.GitaiGameSfx.play('poison');
  assert.equal(buffers.length,2,'unlocked graph plays directly on pointerdown');
 } else if(kind==='quick_failure'){
  tap();time+=30;resumes.shift().fail();
  await Promise.resolve();await Promise.resolve();
  assert.equal(buffers.length,0);
  assert.equal(native.length,1,'fresh failed resume keeps immediate AAC fallback');
 } else throw Error('unknown scenario '+kind);
}
(async()=>{
 for(const name of ['late_success','late_failure','hide_success',
   'hide_failure','cancel','newer_tap','quick_success','quick_failure']){
  await scenario(name);
 }
 console.log('SFX-L02: stale resume success/failure, hide/show, cancel, out-of-order, fresh success/failure and post-unlock pointerdown OK (synthetic VM).');
})().catch(e=>{console.error(e);process.exitCode=1});
