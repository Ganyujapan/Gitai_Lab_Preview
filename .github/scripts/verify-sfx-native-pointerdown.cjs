'use strict';
// SFX-L03: the production SFX module, virtual iPad touches and time.
// This measures JS play() request timing, NOT an actual speaker signal.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync('js/game_sfx.js','utf8');
const index=fs.readFileSync('index.html','utf8');
assert.match(index,/canvas\.addEventListener\('pointerdown', \(e\) => \{/);
assert.match(index,/window\.GitaiGameSfx\?\.play\(/);
assert.match(src,/const instantNativeIOS/);
assert.match(src,/pending\.voice\.retry\(\)/);
function session({search='',failFirst=false}={}){
 let time=1000,rand=0,failed=false,hidden=false;
 const listeners=new Map(),calls=[],starts=[],players=[];
 const document={
  get hidden(){return hidden},
  createElement(){
   const player={src:'',paused:true,currentTime:0,load(){},
     handlers:new Map(),addEventListener(kind,fn){this.handlers.set(kind,fn)},
     removeEventListener(kind,fn){
      if(this.handlers.get(kind)===fn)this.handlers.delete(kind);
     },
     pause(){this.paused=true},
     canPlayType(){return ''},
     play(){
      calls.push({time,player:this,src:this.src});
      if(failFirst&&!failed){failed=true;this.paused=true;throw Error('NotAllowedError')}
      if(this.paused)starts.push({time,player:this,src:this.src});
      this.paused=false;
      return Promise.resolve();
     }
   };
   players.push(player);return player;
  },
  addEventListener(kind,fn){
   const a=listeners.get(kind)||[];a.push(fn);listeners.set(kind,a);
  }
 };
 const window={navigator:{maxTouchPoints:5,userAgent:'iPad',platform:'MacIntel'},
  location:{search},crypto:{getRandomValues(buf){buf[0]=rand++;return buf}},
  AudioContext:null,webkitAudioContext:null,PointerEvent:function(){}};
 const FakeDate={now:()=>time};
 vm.runInNewContext(src,{window,document,Date:FakeDate,Promise,
  Map,Set,Object,Math,Array,Uint32Array},{filename:'game_sfx.js:SFX-L03'});
 function emit(type,id=7,isTrusted=true){
  for(const fn of listeners.get(type)||[])fn({type,pointerId:id,isTrusted});
 }
 return {
  calls,starts,window,players,
  advance(ms){time+=ms},
  emit,
  hit(kind='capture'){
   emit('pointerdown',7);
   window.GitaiGameSfx.play(kind);
  },
  visibility(hide){hidden=hide;emit('visibilitychange')}
 };
}
(async()=>{
 for(const duration of [30,120,300]){
  const a=session();
  a.hit('capture');
  assert.equal(a.starts.length,1,'AAC begins on capture pointerdown');
  assert.equal(a.starts[0].time,1000);
  const original=a.starts[0].player;
  a.advance(duration);
  a.emit('pointerup');
  assert.equal(a.starts.length,1,'no extra audible sound on pointerup');
  assert.equal(a.calls.length,2,'same-player activation fallback call');
  assert.equal(a.calls[1].player,original,'fallback never seeks or switches voice');
  a.emit('touchend');a.emit('click');
  assert.equal(a.starts.length,1,'no duplicate sound');
  a.hit('poison');
  assert.equal(a.starts.length,2,'another tap plays immediately');
  assert.equal(a.starts[1].time,1000+duration);
 }
 {
  const a=session({search:'?sfx=release'});
  a.hit();assert.equal(a.starts.length,0);
  a.advance(120);a.emit('pointerup');
  assert.equal(a.starts.length,1);
  assert.equal(a.starts[0].time,1120,'explicit compatibility mode remains available');
 }
 {
  const a=session({failFirst:true});
  a.hit();
  assert.equal(a.starts.length,0,'rejected pointerdown does not claim audible success');
  a.emit('pointerup',8);assert.equal(a.starts.length,0,'other pointer cannot retry');
  a.advance(30);a.emit('pointerup',7);
  assert.equal(a.starts.length,1,'same real pointerup retries failed native request');
 }
 {
  const a=session();a.hit();
  a.emit('pointercancel',7);a.advance(200);a.emit('pointerup',7);
  assert.equal(a.starts.length,1,'cancel cannot replay a completed capture');
 }
 {
  const a=session();a.hit();
  a.visibility(true);a.visibility(false);a.emit('pointerup',7);
  assert.equal(a.starts.length,1,'background restore cannot replay a hit');
 }
 console.log('SFX-L03: native AAC capture pointerdown requests at 0ms vs release-only +30/120/300ms; same-player gesture retry, blocked playback fallback and no duplicate. Synthetic JS timing only.');
})().catch(e=>{console.error(e);process.exitCode=1});
