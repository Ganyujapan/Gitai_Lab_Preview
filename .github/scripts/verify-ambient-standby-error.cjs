'use strict';
// Run the shipped ambient audio controller, not copied logic. A standby
// decoder error on Safari must not kill a successfully playing rainforest
// ambience; an ACTIVE decoder error must still be surfaced.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('js/ambient_audio.js','utf8');
function fixture() {
  const audio=[],domListeners={};
  const toggle={
    textContent:'',title:'',attributes:{},handlers:{},
    setAttribute(k,v){this.attributes[k]=v;},
    addEventListener(k,cb){this.handlers[k]=cb;},
    click(){this.handlers.click({stopPropagation(){},target:this,type:'click'});}
  };
  class NativeAudio {
    constructor(){
      this.paused=true;this.ended=false;this.muted=false;this.volume=1;
      this.currentTime=0;this.duration=20;this.handlers={};
      this.loop=false;this.rejectNextPlay=false;
    }
    canPlayType(type){assert.equal(type,'audio/ogg; codecs="opus"');return 'probably';}
    setAttribute(){}
    addEventListener(k,cb){(this.handlers[k]??=[]).push(cb);}
    emit(event){for(const fn of this.handlers[event]||[])fn();}
    play(){
      if(this.rejectNextPlay){
        this.rejectNextPlay=false;
        return Promise.reject(Object.assign(Error('simulated iPad standby block'),
          {name:'NotAllowedError'}));
      }
      this.paused=false;this.ended=false;this.emit('playing');
      return Promise.resolve();
    }
    pause(){if(!this.paused){this.paused=true;this.emit('pause');}}
    finish(){
      // Approximate HTMLAudioElement's native-loop behavior at EOF.
      // A player that has loop=true BEFORE its first play must not end.
      this.currentTime=this.duration;
      if(this.loop){this.currentTime=0;this.paused=false;this.ended=false;return;}
      this.paused=true;this.ended=true;this.emit('ended');
    }
  }
  let onTick=null;const timers=new Set();
  const local=new Map(),session=new Map();
  const document={
    baseURI:'https://example.test/Gitai_Lab_Preview/exhibit/game.html',
    hidden:false,
    getElementById:k=>k==='ambientAudioToggle'?toggle:null,
    createElement:k=>{assert.equal(k,'audio');const a=new NativeAudio();audio.push(a);return a;},
    addEventListener(k,cb){domListeners[k]=cb;}
  };
  const window={
    navigator:{userAgent:'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)',audioSession:{type:'ambient'}},
    addEventListener(){},
  };
  const context={
    window,document,URL,Promise,Date,console:{warn(){}},
    localStorage:{getItem:k=>local.get(k)??null,setItem:(k,v)=>local.set(k,v)},
    sessionStorage:{getItem:k=>session.get(k)??null,setItem:(k,v)=>session.set(k,v),
      removeItem:k=>session.delete(k)},
    setInterval(fn){onTick=fn;const id={};timers.add(id);return id;},
    clearInterval(id){timers.delete(id);onTick=null}
  };
  vm.runInNewContext(source,context,{filename:'js/ambient_audio.js',timeout:2500});
  assert.equal(audio.length,2);
  return {audio,toggle,api:window.GitaiAmbientAudio,context,
    tick:()=>onTick?.(),listeners:domListeners};
}
async function flush(){await Promise.resolve();await Promise.resolve();await Promise.resolve();}
(async()=>{
  {
    const t=fixture();
    assert.equal(t.api.isAvailable(),true);
    assert.match(t.toggle.textContent,/環境音 ON/);
    t.audio[1].emit('error');
    assert.equal(t.api.isAvailable(),true,'standby error before play must not disable audio');
    assert.doesNotMatch(t.toggle.textContent,/音源エラー/);
    t.toggle.click();
    await flush();
    assert.equal(t.api.isPlaying(),true,'active audio can start despite stale standby error');
    assert.equal(t.audio[1].muted,false);
    t.audio[1].emit('error');
    assert.equal(t.api.isPlaying(),true,'standby failure cannot stop currently playing audio');
    assert.equal(t.api.isAvailable(),true);
    assert.doesNotMatch(t.toggle.textContent,/音源エラー/);
    t.audio[0].emit('error');
    assert.equal(t.api.isAvailable(),false,'active decoder failure must still be reported');
    assert.equal(t.api.isPlaying(),false);
    assert.match(t.toggle.textContent,/音源エラー/);
  }
  {
    const t=fixture();
    t.toggle.click();
    await flush();
    assert.equal(t.api.isPlaying(),true);
    t.audio[0].currentTime=17;
    t.tick();
    await flush();
    assert.equal(t.api.isPlaying(),true);
    t.audio[0].emit('error');
    assert.equal(t.api.isAvailable(),true,'old active decoder became inactive after crossfade');
    assert.equal(t.api.isPlaying(),true,'old decoder error cannot stop new active playback');
    t.audio[1].emit('error');
    assert.equal(t.api.isAvailable(),false,'new active decoder failure still stops playback');
  }
  {
    // A transient active-player decoder error must not lock the user into
    // a permanent "source error". Retry must use fresh media elements inside
    // the real toggle tap, without changing a game's data or audio preference.
    const t=fixture();
    t.toggle.click();
    await flush();
    const initial=t.audio.slice();
    initial[0].emit('error');
    assert.equal(t.api.isAvailable(),false);
    assert.match(t.toggle.textContent,/音源エラー/);
    assert.equal(t.toggle.attributes['aria-disabled'],'false',
      'a retryable audio error must leave the button available');
    const beforeRetry=t.audio.length;
    t.toggle.click();
    await flush();
    assert.equal(t.audio.length,beforeRetry+2,'retry creates fresh native media elements');
    assert.equal(t.api.isAvailable(),true);
    assert.equal(t.api.isPlaying(),true);
    assert.match(t.toggle.textContent,/再生中/);
    assert.equal(t.audio[2].src,initial[0].src);
    // The original broken player can emit a delayed error after replacement.
    initial[0].emit('error');
    initial[1].emit('error');
    assert.equal(t.api.isAvailable(),true,'stale player errors cannot break recovery');
    assert.equal(t.api.isPlaying(),true);
    // A genuinely persistent error is displayed again, not hidden or
    // automatically retried without explicit user action.
    t.audio[2].emit('error');
    assert.equal(t.api.isAvailable(),false);
    assert.match(t.toggle.textContent,/音源エラー/);
    assert.equal(t.api.isPlaying(),false);
    t.toggle.click();
    await flush();
    assert.equal(t.api.isPlaying(),true,'a later real tap may retry again');
  }
  {
    // A silent 2nd-player preparation or a stalled clock must NOT be able
    // to end a full recording. This was the reported iPad PWA offline bug.
    const t=fixture();
    t.toggle.click();
    assert.equal(t.audio[0].loop,true,
      'native loop must be armed synchronously BEFORE first play');
    await flush();
    t.audio[0].finish();
    assert.equal(t.audio[0].paused,false,
      'if the overlap timer never fires, primary loops instead of stopping');
    assert.equal(t.audio[0].currentTime,0);
    assert.equal(t.api.isPlaying(),true);
    assert.match(t.toggle.textContent,/再生中/);
  }
  {
    // Normal overlap still uses the full-quality four-second crossfade.
    // Only the NEW active element may loop; the old one fades out and ends.
    const t=fixture();
    t.toggle.click();
    await flush();
    t.audio[0].currentTime=17;
    t.tick();
    await flush();
    assert.equal(t.audio[0].loop,false,'old element must not loop after overlap');
    assert.equal(t.audio[1].loop,true,'new active element must have its safety loop');
    t.audio[0].finish();
    assert.equal(t.audio[0].paused,true,
      'the old fade-out must end without keeping a second audio stream alive');
    assert.equal(t.api.isPlaying(),true);
    t.audio[1].finish();
    assert.equal(t.audio[1].paused,false,'new active element keeps native looping');
    assert.equal(t.api.isPlaying(),true);
  }
  {
    // iPadOS can reject standby.play() outside a gesture. Do not mark
    // running=false or let the main loop die. The active stream stays alive.
    const t=fixture();
    t.toggle.click();
    await flush();
    t.audio[1].rejectNextPlay=true;
    t.audio[0].currentTime=17;
    t.tick();
    await flush();
    assert.equal(t.audio[0].loop,true);
    assert.equal(t.audio[1].loop,false);
    assert.equal(t.api.isPlaying(),true);
    t.audio[0].finish();
    assert.equal(t.audio[0].paused,false,'failed overlap must keep native loop alive');
    assert.equal(t.api.isPlaying(),true);
    assert.match(t.toggle.textContent,/再生中/);
  }
  console.log('Ambient: active native fallback survives stalled/blocked overlaps; old fade-out ends; retry and isolation pass.');
})().catch(e=>{console.error(e);process.exitCode=1});
