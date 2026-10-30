'use strict';
// Regression for iOS exhibition: one native AAC media element, no blocked
// standby/overlap, native loop across multiple cycles, watchdog and buttons.
const assert = require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const vm=require('node:vm');
const site=process.argv[2]||'_site';
const exhibit=path.join(site,'exhibit');
const js=fs.readFileSync(path.join(exhibit,'ambient_ios.js'),'utf8');
const game=fs.readFileSync(path.join(exhibit,'game.html'),'utf8');
const publicGame=fs.readFileSync(path.join(site,'index.html'),'utf8');
const audio=fs.readFileSync(path.join(exhibit,'audio/gitailab_rainforest_ios_seamless_loop_48k.m4a'));
const original=fs.readFileSync(path.join(site,'audio/gitailab_rainforest_ios_seamless_loop_48k.m4a'));
assert.equal(audio.length,371392,'AAC file must not be a missing/empty placeholder');
assert.equal(audio.compare(original),0,'exhibit audio must use byte-identical prerecorded source');
assert.equal(crypto.createHash('sha256').update(audio).digest('hex'),
 'c7b62c5147d8e5fdd9318624005f19faa468a4d57191c43ec463ed4641e26d1c');
assert.equal(audio.toString('ascii',4,12),'ftypM4A ');
assert.match(game,/<script src="ambient_ios\.js"><\/script>/);
assert.doesNotMatch(game,/src="js\/ambient_audio\.js/,'only ONE BGM controller');
assert.match(publicGame,/src="js\/ambient_audio\.js/,'normal preview must remain unchanged');
assert.match(js,/loop = true/);
assert.doesNotMatch(js,/\bnew AudioContext\b|\bcreateMediaElementSource\b/);
const precache=JSON.parse(fs.readFileSync(path.join(exhibit,'precache.json'),'utf8'));
for(const file of ['ambient_ios.js','audio/gitailab_rainforest_ios_seamless_loop_48k.m4a']){
 assert.ok(precache.includes(file),'offline PWA must precache '+file);
}

let now=1000000, nextId=0, creates=0;
const callbacks=new Map(), timers=new Map(), flags=new Map(), storage=new Map(), sessions=new Map();
class Clock extends Date{static now(){return now}}
const toggle={
 textContent:'',title:'',
 setAttribute:(k,v)=>flags.set(k,v),
 addEventListener:(kind,fn)=>callbacks.set('toggle:'+kind,fn)
};
class Media{
 constructor(){this.src='';this.loop=false;this.paused=true;this.ended=false;this.duration=45;this.currentTime=0;this.plays=0;this.failNext=false;this.listeners=new Map();}
 setAttribute(){}
 canPlayType(t){return t.includes('mp4')?'probably':''}
 addEventListener(type,fn){
   if(!this.listeners.has(type))this.listeners.set(type,[]);
   this.listeners.get(type).push(fn);
 }
 fire(type){for(const f of this.listeners.get(type)||[])f()}
 play(){
   this.plays++;
   if(this.failNext){this.failNext=false;return Promise.reject(Object.assign(Error('blocked'),{name:'NotAllowedError'}))}
   this.paused=false;this.ended=false;queueMicrotask(()=>this.fire('playing'));
   return Promise.resolve();
 }
 pause(){this.paused=true;this.fire('pause')}
}
const media=[];
const document={
 hidden:false,baseURI:'https://example.test/Gitai_Lab_Preview/exhibit/game.html',
 getElementById:id=>id==='ambientAudioToggle'?toggle:null,
 createElement:type=>{assert.equal(type,'audio');creates++;const p=new Media();media.push(p);return p;},
 addEventListener(type,fn){if(!callbacks.has(type))callbacks.set(type,[]);callbacks.get(type).push(fn)}
};
const root={
 navigator:{userAgent:'iPhone',audioSession:{type:'playback'}},handlers:new Map(),
 addEventListener(type,fn){root.handlers.set(type,fn)}
};
const sandbox={
 window:root,document,URL,Date:Clock,Promise,console,
 setInterval(fn){const id=++nextId;timers.set(id,fn);return id},
 clearInterval(id){timers.delete(id)},
 localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
 sessionStorage:{getItem:k=>sessions.get(k)||null,setItem:(k,v)=>sessions.set(k,v),removeItem:k=>sessions.delete(k)}
};
vm.runInNewContext(js,sandbox,{timeout:5000,filename:'exhibit/ambient_ios.js'});
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
function gesture(type='click'){for(const fn of callbacks.get(type)||[])fn({type,target:{}});}
function tick(ms=500){now+=ms;for(const fn of [...timers.values()])fn();}
(async()=>{
 assert.equal(creates,1,'there must be no standby iOS player');
 assert.match(media[0].src,/\.m4a$/);
 assert.equal(media[0].loop,true);
 assert.equal(root.GitaiAmbientAudio.isPlaying(),false);
 gesture();await flush();
 assert.equal(root.GitaiAmbientAudio.isPlaying(),true);
 assert.equal(media[0].plays,1);
 // Four continuous native AAC loops; timeupdate wraps to 0 with no
 // additional play() needed or second player created.
 for(let loop=0;loop<4;loop++){
   for(const p of [5,15,30,44.8,0.08]){
     media[0].currentTime=p;tick(500);
     media[0].fire('timeupdate');await flush();
   }
   assert.equal(root.GitaiAmbientAudio.isPlaying(),true);
   assert.equal(creates,1);
 }
 assert.equal(media[0].plays,1,'native loop is not manually retriggered or overlapped');
 // Regression for iPhone WebKit: loop attribute is set, but it still
 // emits ended. Existing player is rewound and replayed without new media.
 const plays=media[0].plays;
 media[0].ended=true;media[0].paused=true;media[0].fire('ended');await flush();
 assert.ok(media[0].plays>plays);
 assert.equal(media[0].currentTime,0);
 assert.equal(creates,1);
 // The watchdog detects a pause without another user tap.
 media[0].paused=true;tick(3000);await flush();
 assert.equal(root.GitaiAmbientAudio.isPlaying(),true);
 // BGM toggle acts immediately and leaves SFX independent.
 callbacks.get('toggle:click')({stopPropagation(){}});await flush();
 assert.equal(root.GitaiAmbientAudio.isEnabled(),false);
 assert.equal(media[0].paused,true);
 callbacks.get('toggle:click')({stopPropagation(){}});await flush();
 assert.equal(root.GitaiAmbientAudio.isEnabled(),true);
 assert.equal(root.GitaiAmbientAudio.isPlaying(),true);
 assert.equal(creates,1);
 // A codec/decoder failure must not create a new player until an actual
 // user gesture; the recreated source still loops.
 media[0].error={code:2};media[0].fire('error');
 assert.equal(root.GitaiAmbientAudio.isAvailable(),false);
 gesture();await flush();
 assert.equal(creates,2,'error recovery needs one fresh player, not one per loop');
 assert.equal(root.GitaiAmbientAudio.isAvailable(),true);
 assert.equal(root.GitaiAmbientAudio.isPlaying(),true);
 assert.equal(media[1].loop,true);
 assert.equal(sandbox.indexedDB,undefined,'no save API touched');
 console.log('Exhibition iOS AAC: 4 native loops, ended/paused recovery, toggle, error restore, offline asset and standard isolation OK.');
})().catch(e=>{console.error(e);process.exitCode=1});
