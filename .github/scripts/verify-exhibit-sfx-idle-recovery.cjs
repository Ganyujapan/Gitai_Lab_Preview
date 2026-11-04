'use strict';
// SFX-IDLE-01: synthetic two-minute iPad idle + Safari interrupted AudioContext.
// Execute the real shipping SFX module, with no device, soundcard, storage, or UI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/game_sfx.js', 'utf8');
assert.match(source, /frozenClockFallback/);
function fixture() {
  let now = 1000, random = 0, hidden = false, context, nativeRequests = 0;
  const handlers = new Map(), buffers = [], native = [], decoded = [];
  const FakeDate = class extends Date { static now(){ return now; } };
  class Audio {
    constructor() {
      this.paused = true; this.src = ''; this.currentTime = 0;
      this.volume = 1; this.handlers = new Map();
    }
    canPlayType(){ return ''; }
    load(){}
    pause(){ this.paused = true; }
    addEventListener(name, fn){ this.handlers.set(name, fn); }
    removeEventListener(name, fn){
      if (this.handlers.get(name) === fn) this.handlers.delete(name);
    }
    play(){
      nativeRequests++;
      if (this.paused) native.push({src:this.src,now});
      this.paused = false;
      return Promise.resolve();
    }
  }
  const document = {
    get hidden(){return hidden},
    createElement(name){ assert.equal(name,'audio'); return new Audio(); },
    addEventListener(name,fn){
      const callbacks = handlers.get(name) || [];
      callbacks.push(fn); handlers.set(name, callbacks);
    }
  };
  class Context {
    constructor(){
      context = this;
      this.state = 'running'; this.currentTime = 4;
      this.destination = {}; this.handlers = {};
      this.blockResume = false;
    }
    addEventListener(name, fn){ this.handlers[name] = fn; }
    createDynamicsCompressor(){
      return {threshold:{},knee:{},ratio:{},attack:{},release:{},connect(){}};
    }
    createGain(){return {gain:{},connect(){},disconnect(){}};}
    createBufferSource(){
      return {buffer:null,connect(){},disconnect(){},stop(){},onended:null,
        start(){buffers.push({src:this.buffer.path,now})}};
    }
    decodeAudioData(bytes){
      decoded.push(bytes.path);
      return Promise.resolve({path:bytes.path});
    }
    resume(){
      if (this.blockResume) return new Promise(()=>{});
      this.state = 'running';
      return Promise.resolve();
    }
    interrupt(){
      this.state = 'interrupted';
      this.handlers.statechange?.();
    }
  }
  const window = {
    location:{pathname:'/Gitai_Lab_Preview/exhibit/game.html',search:''},
    navigator:{userAgent:'iPad',platform:'MacIntel',maxTouchPoints:5},
    AudioContext:Context,PointerEvent:function(){},
    crypto:{getRandomValues(a){a[0]=random++;return a;}},
    fetch:async path=>({ok:true,arrayBuffer:async()=>({path})}),
    GitaiAmbientAudio:{activatePlaybackSession(){}}
  };
  vm.runInNewContext(source,{
    document,window,Date:FakeDate,Promise,Map,Set,Array,Object,
    Uint32Array,Math,console
  },{filename:'js/game_sfx.js:SFX-IDLE-01',timeout:5000});
  function emit(name, id=7, trusted=true){
    for(const fn of handlers.get(name)||[])fn({
      type:name,pointerId:id,isTrusted:trusted,pointerType:'touch'
    });
  }
  function down(kind='capture',id=7){
    emit('pointerdown',id);
    if(kind)window.GitaiGameSfx.play(kind);
  }
  function up(id=7){emit('pointerup',id);}
  async function settle(){for(let i=0;i<8;i++)await Promise.resolve();}
  return {
    document,window,buffers,native,decoded,emit,down,up,settle,
    get context(){return context},
    get nativeRequests(){return nativeRequests},
    async prepared(){await window.GitaiGameSfx.prepare()},
    advance(ms,clockSecs=0){now+=ms;context.currentTime+=clockSecs},
    visibility(value){hidden=value;emit('visibilitychange')}
  };
}
(async()=>{
  // Healthy iPad Web Audio starts promptly and is not degraded to native.
  const healthy = fixture();
  await healthy.prepared();
  assert.equal(healthy.decoded.length,10);
  healthy.down('capture');healthy.up();await healthy.settle();
  assert.equal(healthy.buffers.length,1);
  assert.equal(healthy.native.length,0);
  healthy.advance(100,0.10);
  healthy.down('poison');healthy.up();await healthy.settle();
  assert.equal(healthy.buffers.length,2);
  assert.equal(healthy.native.length,0);

  // The real bug: after 120s the context still reports 'running', but the
  // audio rendering clock did not advance. No WebAudio sounds are audible.
  healthy.advance(120000,0);
  healthy.down('capture');healthy.up();await healthy.settle();
  assert.equal(healthy.buffers.length,2,'frozen graph must get no new buffers');
  assert.equal(healthy.native.length,1,'first sound after 2-minute idle uses AAC');
  // Harmless touches without a moth must not reset the fallback.
  healthy.down(null);healthy.up();await healthy.settle();
  for(const kind of ['capture','poison','death']){
    healthy.advance(400,0);
    healthy.down(kind);healthy.up();await healthy.settle();
  }
  assert.equal(healthy.native.length,4,
    'all subsequent kinds must remain audible through the native route');
  assert.equal(healthy.buffers.length,2,
    'no attempts to silently replay buffers into the frozen graph');
  // A cancel from a different finger does not play the pending sound.
  healthy.down('capture',42);
  healthy.emit('pointercancel',42);
  healthy.up(42);await healthy.settle();
  assert.equal(healthy.native.length,4,'cancelled hit must not return');
  assert.equal(healthy.nativeRequests,4,'no repeated native voices');

  // A genuinely interrupted context may leave resume() unresolved forever.
  const interrupted=fixture();await interrupted.prepared();
  interrupted.down();interrupted.up();await interrupted.settle();
  assert.equal(interrupted.buffers.length,1);
  interrupted.context.interrupt();
  interrupted.context.blockResume=true;
  interrupted.advance(120000,0);
  interrupted.down('poison');interrupted.up();await interrupted.settle();
  assert.equal(interrupted.native.length,1,
    'interrupted context must request AAC in a trusted gesture, no await');
  assert.equal(interrupted.buffers.length,1);

  // A mere temporary interruption whose clock progresses again can return
  // to the low-latency engine after WebKit really resumes.
  const recovering=fixture();await recovering.prepared();
  recovering.down();recovering.up();await recovering.settle();
  recovering.context.interrupt();
  recovering.context.blockResume=false;
  recovering.advance(500,0.5);
  recovering.down('capture');recovering.up();await recovering.settle();
  assert.equal(recovering.buffers.length,2,'healthy resumed clock may recover');
  assert.equal(recovering.native.length,0);

  console.log('SFX-IDLE-01: 120s frozen clock sticky AAC, inert pointerup, interrupted hung resume, recovered clock, cancellation, and healthy Web Audio PASS');
})().catch(error=>{console.error(error);process.exitCode=1});
