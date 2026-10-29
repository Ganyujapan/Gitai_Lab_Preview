'use strict';
// Isolated exhibition listening bench: production SFX module, no real game DB.
// This checks input routing, no-storage isolation and the optional BGM path.
// JS dispatch timing is NOT measured as acoustic onset.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('exhibit/sfx_latency_rehearsal.html','utf8');
const js=fs.readFileSync('exhibit/sfx_latency_rehearsal.js','utf8');
const engine=fs.readFileSync('js/game_sfx.js','utf8');
const build=fs.readFileSync('exhibit/build.py','utf8');
const workflow=fs.readFileSync('.github/workflows/verify-public-preview.yml','utf8');
assert.match(html,/<meta name="robots" content="noindex,nofollow">/);
assert.ok(html.indexOf('src="js/game_sfx.js" defer') <
  html.indexOf('src="sfx_latency_rehearsal.js" defer'));
assert.match(build,/"sfx_latency_rehearsal.html", "sfx_latency_rehearsal.js"/);
assert.match(build,/assert "sfx_latency_rehearsal.js" not in page_source/);
assert.match(workflow,/verify-sfx-latency-rehearsal\.cjs/);
assert.match(engine,/const lowLatencyIOS = iosDevice\s*&&/);
assert.match(engine,/soundParam === 'fast'/);
assert.match(engine,/sfx=release/);
assert.match(engine,/const instantNativeIOS = iosDevice &&/);
assert.doesNotMatch(js,/\b(?:indexedDB|localStorage|sessionStorage|deleteDatabase|WebSocket)\b/,
  'isolated listening bench must never touch game data or settings');
assert.doesNotMatch(html,/<script[^>]+(?:pages_preview|admin|game\.js)/);

function harness(search) {
  const elements=new Map(), audioPlays=[], sounds=[], listeners={}, audio=[];
  function node(id) {
    const handlers={};
    const n={id,dataset:{},attributes:{},textContent:'',disabled:false,
      setAttribute(k,v){this.attributes[k]=v},
      addEventListener(k,fn){handlers[k]=fn},
      emit(k,arg){handlers[k]?.(arg||{})}
    };
    elements.set(id,n); return n;
  }
  for(const id of ['routeNative','routeFast','routeRelease','routeStatus',
    'status','report','bgmToggle','copy','copyStatus'])node(id);
  const buttons=['capture','poison','death'].map(kind=>{
    const el=node('sound-'+kind);el.dataset.sfx=kind;return el;
  });
  const doc={
    getElementById:id=>elements.get(id),
    querySelectorAll:selector=>selector==='[data-sfx]'?buttons:[],
    createElement(tag){
      assert.equal(tag,'audio');
      const player={src:'',loop:false,preload:'',playsInline:false,volume:1,
        paused:true,play(){this.paused=false;audioPlays.push(this.src);return Promise.resolve();},
        pause(){this.paused=true;}};
      audio.push(player);return player;
    }
  };
  const navigator={
    audioSession:{type:'ambient'},
    clipboard:{writeText:async text=>{listeners.copied=text}}
  };
  const window={
    GitaiGameSfx:{
      prepare:()=>Promise.resolve(),
      play:kind=>sounds.push(kind)
    },
    addEventListener:(name,fn)=>{listeners[name]=fn}
  };
  const context={window,document:doc,navigator,location:{search},
    URLSearchParams,Date,Promise};
  vm.runInNewContext(js,context,{filename:'exhibit/sfx_latency_rehearsal.js'});
  return {elements,buttons,sounds,audio,audioPlays,navigator,window,listeners};
}
(async()=>{
 for(const [query,current] of [
   ['?sfx=native', 'routeNative'],['?sfx=fast','routeFast'],['?sfx=release','routeRelease']]){
   const h=harness(query);
   await Promise.resolve();
   assert.equal(h.elements.get(current).attributes['aria-current'],'page');
   assert.equal(h.buttons.length,3);
   for(const b of h.buttons) {
     b.emit('pointerdown',{isPrimary:true,button:0});
   }
   assert.deepEqual(h.sounds,['capture','poison','death']);
   h.buttons[0].emit('pointerdown',{isPrimary:false,button:0});
   h.buttons[0].emit('pointerdown',{isPrimary:true,button:2});
   assert.equal(h.sounds.length,3,'right click and second touch are ignored');
   assert.match(h.elements.get('report').textContent,/捕食タップ: 1/);
   const toggle=h.elements.get('bgmToggle');
   toggle.emit('click');
   assert.equal(h.audioPlays.length,1);
   assert.equal(h.navigator.audioSession.type,'playback');
   assert.equal(toggle.attributes['aria-pressed'],'true');
   toggle.emit('click');
   assert.equal(h.audio[0].paused,true);
   assert.equal(toggle.attributes['aria-pressed'],'false');
   toggle.emit('click');
   h.listeners.pagehide();
   assert.equal(h.audio[0].paused,true);
   h.elements.get('copy').emit('click');
   await new Promise(resolve=>setImmediate(resolve));
   assert.match(h.listeners.copied,/iPad効果音比較/);
   assert.equal(h.elements.get('copyStatus').textContent.includes('コピー'),true);
 }
 console.log('SFX-LAG: isolation, three routes, production SFX loading order, button requests, optional BGM and copy report OK. Acoustic onset requires iPad.');
})().catch(e=>{console.error(e);process.exitCode=1});
