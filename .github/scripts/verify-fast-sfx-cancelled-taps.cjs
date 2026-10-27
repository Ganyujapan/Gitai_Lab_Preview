'use strict';
// PF02: exercise the REAL opt-in ?sfx=fast iOS code with pointercancel,
// visibility loss, multi-touch and stale taps. AudioContext intentionally
// unavailable to assert fast fallback always obeys original tap identity.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('js/game_sfx.js','utf8');
assert.match(source,/function queueFastSound\(/);
assert.match(source,/pendingFastSound\.pointerId === event\.pointerId/);
assert.match(source,/pendingFastSound = null;/);
function harness({pointerSupport=true}={}){
 const handlers=new Map(),plays=[];
 let now=10000,variant=0;
 const doc={hidden:false,
  createElement:()=>({
   src:'',currentTime:0,canPlayType:()=>'',volume:1,handlers:new Map(),
   load(){},pause(){},
   addEventListener(name,fn){this.handlers.set(name,fn)},
   removeEventListener(name,fn){if(this.handlers.get(name)===fn)this.handlers.delete(name)},
   play(){plays.push(this.src);return Promise.resolve()}
  }),
  addEventListener(name,fn){const arr=handlers.get(name)||[];arr.push(fn);handlers.set(name,arr)}
 };
 const window={
  navigator:{maxTouchPoints:5,userAgent:'iPad',platform:'MacIntel'},
  location:{search:'?sfx=fast'},
  AudioContext:null,webkitAudioContext:null,
  crypto:{getRandomValues(a){a[0]=variant++;return a;}},
  ...(pointerSupport?{PointerEvent:function(){}}:{})
 };
 vm.runInNewContext(source,{window,document:doc,Date:{now:()=>now},
  Promise,Map,Set,Uint32Array,Math,Number,Array,Object},{
  filename:'js/game_sfx.js:PF02-fast',timeout:5000});
 const emit=(name,pointerId=1,isTrusted=true)=>{
   for(const fn of handlers.get(name)||[])fn({type:name,pointerId,isTrusted});
 };
 return {window,doc,plays,emit,
   play:()=>window.GitaiGameSfx.play('capture'),
   advance:ms=>now+=ms};
}
(async()=>{
 const normal=harness();
 normal.emit('pointerdown',3);normal.play();
 normal.emit('pointerup',3);
 normal.emit('touchend',3);
 normal.emit('click',3);
 assert.equal(normal.plays.length,1,'one sound on original successful gesture');

 const cancelled=harness();
 cancelled.emit('pointerdown',11);cancelled.play();
 cancelled.emit('pointercancel',11);
 cancelled.emit('pointerup',11);
 cancelled.emit('click',11);
 cancelled.emit('pointerdown',12);
 cancelled.emit('pointerup',12);
 assert.equal(cancelled.plays.length,0,'cancelled first tap never resurrects');

 const wrongFinger=harness();
 wrongFinger.emit('pointerdown',21);wrongFinger.play();
 wrongFinger.emit('pointerdown',22);
 wrongFinger.emit('pointerup',22);
 wrongFinger.emit('touchend',22);
 assert.equal(wrongFinger.plays.length,0);
 wrongFinger.emit('pointerup',21);
 assert.equal(wrongFinger.plays.length,1,'only the capturing finger flushes sound');

 const hidden=harness();
 hidden.emit('pointerdown',31);hidden.play();
 hidden.doc.hidden=true;hidden.emit('visibilitychange');
 hidden.doc.hidden=false;hidden.emit('pointerup',31);
 assert.equal(hidden.plays.length,0);

 const expired=harness();
 expired.emit('pointerdown',41);expired.play();
 expired.advance(2600);expired.emit('pointerup',41);
 expired.emit('click',41);
 assert.equal(expired.plays.length,0);

 const fake=harness();
 fake.emit('pointerdown',51);fake.play();
 fake.emit('click',51,false);
 fake.emit('pointerup',51,false);
 assert.equal(fake.plays.length,0);
 fake.emit('pointerup',51,true);
 assert.equal(fake.plays.length,1);

 const legacy=harness({pointerSupport:false});
 legacy.emit('pointerdown',61);legacy.play();
 legacy.emit('touchend',61);
 assert.equal(legacy.plays.length,1);

 const cancelOther=harness();
 cancelOther.emit('pointerdown',71);cancelOther.play();
 cancelOther.emit('pointercancel',72);
 cancelOther.emit('pointerup',71);
 assert.equal(cancelOther.plays.length,1);

 console.log('PF02-fast: original pointer only; cancel, background, expiration and synthetic tap cannot replay queued sound.');
})().catch(e=>{console.error(e);process.exitCode=1});
