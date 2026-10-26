'use strict';
// PF02: drive the real native iOS SFX script with trusted pointer events.
// No real Audio, DOM, user IndexedDB, or evolution logic is touched.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('js/game_sfx.js','utf8');
assert.match(source,/pointercancel/);
assert.match(source,/TOUCH_SOUND_MAX_AGE_MS/);
function harness({pointerSupport=true}={}){
 const events=new Map(),nativePlays=[],allPlayers=[];
 let now=10000,variant=0;
 const document={hidden:false,
  createElement(){
    const p={src:'',currentTime:0,canPlayType:()=>'',volume:1,paused:true,
      handlers:new Map(),load(){},pause(){this.paused=true;},
      addEventListener(k,fn){this.handlers.set(k,fn);},
      removeEventListener(k,fn){if(this.handlers.get(k)===fn)this.handlers.delete(k);},
      play(){nativePlays.push(this.src);this.paused=false;return Promise.resolve();}
    };
    allPlayers.push(p);return p;
  },
  addEventListener(name,fn){if(!events.has(name))events.set(name,[]);events.get(name).push(fn);}
 };
 const window={
  navigator:{maxTouchPoints:5,userAgent:'iPad',platform:'MacIntel'},
  location:{search:''},
  AudioContext:null,webkitAudioContext:null,
  crypto:{getRandomValues(a){a[0]=variant++;return a;}},
  ...(pointerSupport?{PointerEvent:function(){}}:{})
 };
 const FakeDate={now:()=>now};
 vm.runInNewContext(source,{window,document,Date:FakeDate,
   Promise,Map,Object,Math,Array,Uint32Array,Set},
   {filename:'js/game_sfx.js:PF02',timeout:5000});
 function emit(type,{pointerId=1,isTrusted=true}={}){
   for(const fn of events.get(type)||[])fn({type,pointerId,isTrusted});
 }
 return {window,document,nativePlays,allPlayers,
  emit,advance:(ms)=>{now+=ms;},play:(kind='capture')=>window.GitaiGameSfx.play(kind)};
}
(async()=>{
 const regular=harness();
 regular.emit('pointerdown',{pointerId:7});regular.play();
 regular.emit('pointerup',{pointerId:7});
 regular.emit('touchend',{pointerId:7});regular.emit('click',{pointerId:7});
 assert.equal(regular.nativePlays.length,1,'single sound despite pointer/touch/click duplicates');

 const cancelled=harness();
 cancelled.emit('pointerdown',{pointerId:11});cancelled.play();
 cancelled.emit('pointercancel',{pointerId:11});
 cancelled.emit('click',{pointerId:11});
 cancelled.emit('pointerdown',{pointerId:22});
 cancelled.emit('pointerup',{pointerId:22});
 assert.equal(cancelled.nativePlays.length,0,'cancelled sound never reappears');

 const invisible=harness();
 invisible.emit('pointerdown',{pointerId:3});invisible.play();
 invisible.document.hidden=true;invisible.emit('visibilitychange');
 invisible.document.hidden=false;invisible.emit('pointerup',{pointerId:3});
 assert.equal(invisible.nativePlays.length,0,'hidden PWA discards pending touch');

 const held=harness();
 held.emit('pointerdown',{pointerId:4});held.play();
 held.advance(700);held.emit('pointerup',{pointerId:4});
 assert.equal(held.nativePlays.length,1,'normal long press still plays on release');

 const expired=harness();
 expired.emit('pointerdown',{pointerId:5});expired.play();
 expired.advance(2700);expired.emit('pointerup',{pointerId:5});
 expired.emit('click',{pointerId:5});
 assert.equal(expired.nativePlays.length,0,'stale long press never plays later');

 const multitouch=harness();
 multitouch.emit('pointerdown',{pointerId:6});multitouch.play();
 multitouch.emit('pointerdown',{pointerId:7}); // second finger, no moth capture
 multitouch.emit('pointerup',{pointerId:7});
 assert.equal(multitouch.nativePlays.length,0,'other finger cannot flush first hit');
 multitouch.emit('pointerup',{pointerId:6});
 assert.equal(multitouch.nativePlays.length,1);
 multitouch.emit('touchend',{pointerId:6});
 assert.equal(multitouch.nativePlays.length,1);

 const synthetic=harness();
 synthetic.emit('pointerdown',{pointerId:8});synthetic.play();
 synthetic.emit('click',{pointerId:8,isTrusted:false});
 assert.equal(synthetic.nativePlays.length,0);
 synthetic.emit('pointerup',{pointerId:8,isTrusted:true});
 assert.equal(synthetic.nativePlays.length,1);

 const fallback=harness({pointerSupport:false});
 fallback.emit('pointerdown',{pointerId:9});fallback.play();
 fallback.emit('touchend',{pointerId:9});
 assert.equal(fallback.nativePlays.length,1,'legacy touchend remains fallback');

 console.log('PF02: native iOS normal/cancel/hidden/long/expired/multitouch/synthetic/double event paths OK.');
})().catch(error=>{console.error(error);process.exitCode=1;});
