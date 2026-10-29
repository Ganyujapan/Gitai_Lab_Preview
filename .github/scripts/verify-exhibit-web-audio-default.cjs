'use strict';
// T-003 B-2: the real sound module must default to the user-validated
// low-latency Web Audio path in /exhibit/game.html only. No real device/DB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/game_sfx.js', 'utf8');
const mainHtml = fs.readFileSync('index.html', 'utf8');
const bench = fs.readFileSync('exhibit/sfx_latency_rehearsal.html', 'utf8');
assert.match(mainHtml, /src="js\/game_sfx\.js\?v=20261029-exhibit-default-webaudio1"/);
assert.match(bench, /sfx_latency_rehearsal\.html\?sfx=native/);
assert.match(bench, /sfx_latency_rehearsal\.html\?sfx=fast/);
assert.match(bench, /sfx_latency_rehearsal\.html\?sfx=release/);
assert.match(source, /const exhibitGame = /); // actual route behavior checked below

function makeSession({pathname='/exhibit/game.html', search='', browser='iPad', ctxAvailable=true}={}) {
  let time=1000, rand=0;
  const starts=[], nativeStarts=[], loaded=[], decoded=[], listeners=new Map();
  const players=[];
  let lastContext;
  class TestAudioContext {
    constructor() {
      lastContext=this;
      this.state='suspended';
      this.currentTime=0;
      this.destination={};
      this.events={};
      this.resumeCalls=0;
      this.threshold=null;
    }
    addEventListener(name, fn) { this.events[name]=fn; }
    createDynamicsCompressor() {
      return {threshold:{},knee:{},ratio:{},attack:{},release:{},connect(){}};
    }
    createGain() { return {gain:{},connect(){},disconnect(){}}; }
    createBufferSource() {
      return {buffer:null,connect(){},disconnect(){},stop(){},onended:null,
        start(){starts.push({time,buffer:this.buffer});}};
    }
    decodeAudioData(bytes) {decoded.push(bytes.path);return Promise.resolve({path:bytes.path});}
    resume() {this.resumeCalls++;this.state='running';return Promise.resolve();}
  }
  const document={
    hidden:false,
    createElement(tag) {
      assert.equal(tag,'audio');
      const p={src:'',paused:true,volume:1,currentTime:0,preload:'',
        playsInline:false, events:new Map(), canPlayType:()=>'',load(){loaded.push(this.src)},
        addEventListener(name,fn){this.events.set(name,fn)},
        removeEventListener(name,fn){if(this.events.get(name)===fn)this.events.delete(name)},
        pause(){this.paused=true},
        play(){
          if(this.paused)nativeStarts.push({time,src:this.src});
          this.paused=false;return Promise.resolve();
        }};
      players.push(p);return p;
    },
    addEventListener(name,cb) {
      const list=listeners.get(name)||[];
      list.push(cb);listeners.set(name,list);
    }
  };
  const window={
    location:{pathname,search},
    navigator:browser==='iPad'
      ? {userAgent:'iPad',platform:'MacIntel',maxTouchPoints:5}
      : {userAgent:'Desktop Safari',platform:'MacIntel',maxTouchPoints:0},
    AudioContext:ctxAvailable?TestAudioContext:null,
    webkitAudioContext:null,
    crypto:{getRandomValues(a){a[0]=rand++;return a}},
    fetch:async path=>({ok:true,arrayBuffer:async()=>({path})}),
    GitaiAmbientAudio:{activatePlaybackSession(){}},
    PointerEvent:function(){}
  };
  vm.runInNewContext(source,{window,document,Date:{now:()=>time},
    Promise,Map,Set,Uint32Array,Array,Object,Math},
    {filename:'js/game_sfx.js'});
  function emit(type,pointerId=7){
    for(const fn of listeners.get(type)||[])fn({
      type,pointerId,isTrusted:true,pointerType:'touch'
    });
  }
  return {
    window, document, starts,nativeStarts,loaded,decoded,
    getContext:()=>lastContext,
    async prepared(){await window.GitaiGameSfx.prepare()},
    down(){emit('pointerdown')},
    up(){emit('pointerup')},
    tap(kind='capture'){
      emit('pointerdown');
      window.GitaiGameSfx.play(kind);
    },
    advance(n){time+=n}
  };
}

(async()=>{
  // Both supported exhibition modes share the same generated game.html and
  // work with a query string containing mode, env and generation data.
  for(const pathname of [
    '/Gitai_Lab_Preview/exhibit/game.html',
    '/Gitai_Lab_Preview/exhibit/game.html'
  ]) {
    const s=makeSession({pathname,search:'?mode=warning&gen=26'});
    await s.prepared();
    assert.equal(s.decoded.length,10,'all ten recorded AAC effects decoded ahead of play');
    s.tap('capture');
    assert.equal(s.starts.length,0,'new document first tap awaits trusted release');
    s.up();
    await Promise.resolve();await Promise.resolve();
    assert.equal(s.starts.length,1,'first tap starts after one real release');
    assert.equal(s.nativeStarts.length,0,'native AAC not used on healthy Web Audio');
    s.tap('poison');
    assert.equal(s.starts.length,2,'second hit starts at pointerdown without waiting');
    s.tap('death');
    assert.equal(s.starts.length,3,'death effect uses same low-latency playback');
    assert.equal(s.nativeStarts.length,0,'all healthy effects stay Web Audio');
    assert.ok(s.starts[0].buffer.path.includes('/aac/capture_'));
    assert.ok(s.starts[1].buffer.path.includes('/aac/poison_'));
    assert.ok(s.starts[2].buffer.path.includes('/aac/death_'));
    // A generation creates a new document and AudioContext. The next session
    // must re-arm on a real gesture instead of relying on a synthetic click.
    const next=makeSession({pathname,search:'?mode=warning&gen=27'});
    await next.prepared();
    next.tap('capture');next.up();
    await Promise.resolve();await Promise.resolve();
    assert.equal(next.starts.length,1,'after generation reload, first hit recovers');
    next.tap('capture');
    assert.equal(next.starts.length,2,'later hit is synchronous again');
  }

  // The regular preview and the isolated listening bench keep their prior
  // default to avoid changing behavior on non-exhibition iPhones/iPads.
  for(const pathname of ['/Gitai_Lab_Preview/', '/Gitai_Lab_Preview/exhibit/sfx_latency_rehearsal.html']){
    const s=makeSession({pathname});
    await s.prepared();
    assert.equal(s.decoded.length,0,'public/bench default stays AAC');
    s.tap();
    assert.equal(s.nativeStarts.length,1,'native starts at pointerdown');
    assert.equal(s.starts.length,0,'public/bench do not implicitly enable Web Audio');
  }
  // Emergency fallback can be selected on the exhibition URL at any time.
  for(const search of ['?sfx=native','?mode=cryptic&sfx=native&play=1']){
    const s=makeSession({search});
    await s.prepared();s.tap();
    assert.equal(s.nativeStarts.length,1,'explicit native fallback plays immediately');
    assert.equal(s.starts.length,0);
  }
  const release=makeSession({search:'?sfx=release'});
  await release.prepared();release.tap();
  assert.equal(release.nativeStarts.length,0);
  release.up();
  assert.equal(release.nativeStarts.length,1,'old pointerup compatibility survives');
  // Opt-in fast is still available outside of exhibition for diagnostics.
  const opt=makeSession({pathname:'/Gitai_Lab_Preview/',search:'?sfx=fast'});
  await opt.prepared();assert.equal(opt.decoded.length,10);
  opt.tap();opt.up();await Promise.resolve();await Promise.resolve();
  assert.equal(opt.starts.length,1);

  // An unsupported AudioContext must fall back on the first real release,
  // rather than dropping the hit or blocking the next round.
  const unavailable=makeSession({ctxAvailable:false});
  await unavailable.prepared();
  unavailable.tap();
  assert.equal(unavailable.starts.length,0);
  unavailable.up();
  assert.equal(unavailable.nativeStarts.length,1,'unavailable Web Audio falls back AAC');
  // Non-iOS desktop behavior is untouched.
  const desktop=makeSession({browser:'desktop',pathname:'/Gitai_Lab_Preview/exhibit/game.html'});
  await desktop.prepared();
  assert.equal(desktop.decoded.length,10);
  console.log('EXHIBIT SFX: default fast route, first/next-generation rearm, capture/poison/death, native/release escape hatch, isolation and unsupported fallback verified in production JS. Acoustic latency awaits iPad.');
})().catch(error=>{console.error(error);process.exitCode=1});
