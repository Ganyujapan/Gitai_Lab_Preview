'use strict';
// Execute the exact exhibition-built audio controller with simulated iPad
// native players. No real user data, network or physical media is required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const site = process.argv[2] || '_site';
const exhibit = fs.readFileSync(path.join(site,'exhibit/js/ambient_audio.js'),'utf8');
const publicAudio = fs.readFileSync(path.join(site,'js/ambient_audio.js'),'utf8');
assert.match(exhibit,/lastAutoResumeAttemptAt/);
assert.match(exhibit,/resumeFromGesture\(\)/);
assert.doesNotMatch(publicAudio,/lastAutoResumeAttemptAt/,'standard preview audio remains unchanged');
const listeners={}, media=[], timers=[], attr={};
const button={setAttribute(k,v){attr[k]=v},textContent:'',title:''};
class Player {
 constructor(){this.paused=true;this.ended=false;this.currentTime=0;this.duration=27;this.loop=false;this.muted=false;this.listeners={};this.plays=0;}
 setAttribute(){}
 canPlayType(){return 'probably'}
 addEventListener(event,callback){(this.listeners[event] ||= []).push(callback)}
 emit(event){for(const callback of this.listeners[event]||[])callback()}
 play(){this.plays++;this.paused=false;this.ended=false;queueMicrotask(()=>this.emit('playing'));return Promise.resolve()}
 pause(){this.paused=true;this.emit('pause')}
}
const document={
 baseURI:'https://example.test/exhibit/game.html',hidden:false,
 getElementById:id=>id==='ambientAudioToggle'?button:null,
 createElement:type=>{assert.equal(type,'audio');const p=new Player();media.push(p);return p},
 addEventListener:(type,cb)=>{(listeners[type] ||= []).push(cb)}
};
const session=new Map(),prefs=new Map();
const root={navigator:{userAgent:'iPad',audioSession:{type:'playback'}},
 addEventListener(){}};
const ctx={window:root,document,URL,Date,Promise,console,
 sessionStorage:{getItem:k=>session.get(k)||null,removeItem:k=>session.delete(k),setItem:(k,v)=>session.set(k,v)},
 localStorage:{getItem:k=>prefs.get(k)||null,setItem:(k,v)=>prefs.set(k,v)},
 setInterval:cb=>{timers.push(cb);return timers.length},clearInterval(){}};
vm.runInNewContext(exhibit,ctx,{timeout:5000});
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve()};
const gesture=()=>{for(const cb of listeners.click||[])cb({type:'click',target:{}})};
(async()=>{
 assert.equal(media.length,2);
 assert.equal(root.GitaiAmbientAudio.isPlaying(),false);
 gesture();await flush();
 assert.equal(root.GitaiAmbientAudio.isPlaying(),true,'first user tap starts ambience');
 const active=media[0], firstPlays=active.plays;
 assert.equal(active.loop,true,'native backup loop armed before playback');
 active.paused=true; // model silent interruption while app remains visible
 timers.at(-1)();await flush();
 assert.ok(active.plays>firstPlays,'idle watchdog retries authorized active native player');
 active.ended=true;active.paused=true;const before=active.plays;
 active.emit('ended');await flush();
 assert.ok(active.plays>before,'unexpected ended event attempts continuation');
 active.emit('error');await flush();
 assert.equal(root.GitaiAmbientAudio.isAvailable(),false);
 gesture();await flush();
 assert.equal(root.GitaiAmbientAudio.isAvailable(),true,
   'a subsequent real tap retries a transient active-decoder error');
 assert.ok(media.length>=4,'failed decoder is replaced without touching other state');
 assert.equal(typeof root.GitaiAmbientAudio.resumeFromGesture,'function');
 root.GitaiAmbientAudio.resumeFromGesture();
 await flush();
 assert.equal(root.GitaiAmbientAudio.isPlaying(),true);
 console.log('Exhibition BGM: idle pause, native ended, transient decoder error and genuine-gesture resume passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
