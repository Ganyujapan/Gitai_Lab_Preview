'use strict';
// iPad BUG-01: model WebKit media that reports paused=false and "playing"
// forever, plus a standby play() Promise that never settles. Execute the
// actual exhibition-built controller; never touch real browser storage.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const base=process.argv[2]||'_site';
const script=fs.readFileSync(path.join(base,'exhibit/js/ambient_audio.js'),'utf8');
const standard=fs.readFileSync(path.join(base,'js/ambient_audio.js'),'utf8');
assert.match(script,/watchedPosition/);
assert.match(script,/switchingStartedAt/);
assert.match(script,/player\.addEventListener\('timeupdate'/);
assert.doesNotMatch(standard,/watchedPosition/,'do not modify normal preview');
let now=1000000, serial=0;
const DateClock=class extends Date{static now(){return now}};
const timers=new Map(), handlers=new Map(), audio=[];
const toggle={setAttribute(){},addEventListener(event,fn){handlers.set('toggle:'+event,fn)},textContent:'',title:''};
class Player {
 constructor(){
  this.loop=false;this.muted=false;this.paused=true;this.ended=false;
  this.currentTime=0;this.duration=29;this.plays=0;this.pendingNextPlay=false;
  this.listeners=new Map();
 }
 setAttribute(){}
 canPlayType(){return 'probably'}
 addEventListener(type,fn){
  if(!this.listeners.has(type))this.listeners.set(type,[]);
  this.listeners.get(type).push(fn);
 }
 emit(type){for(const fn of this.listeners.get(type)||[])fn()}
 play(){
  this.plays++;
  if(this.pendingNextPlay){this.pendingNextPlay=false;return new Promise(()=>{});}
  this.paused=false;this.ended=false;
  queueMicrotask(()=>this.emit('playing'));
  return Promise.resolve();
 }
 pause(){this.paused=true;this.emit('pause')}
}
const document={
 hidden:false,baseURI:'https://example.org/exhibit/game.html',
 getElementById:id=>id==='ambientAudioToggle'?toggle:null,
 createElement:type=>{
  assert.equal(type,'audio');const p=new Player();audio.push(p);return p;
 },
 addEventListener(type,cb){
  if(!handlers.has(type))handlers.set(type,[]);
  handlers.get(type).push(cb);
 }
};
const window={
 navigator:{userAgent:'iPad',audioSession:{type:'playback'}},
 addEventListener(){}
};
const ctx={window,document,URL,Date:DateClock,console,Promise,
 localStorage:{getItem(){return null},setItem(){}},
 sessionStorage:{getItem(){return null},setItem(){},removeItem(){}},
 setInterval(fn){const key=++serial;timers.set(key,fn);return key},
 clearInterval(key){timers.delete(key)}};
vm.runInNewContext(script,ctx,{filename:'exhibit-built-ambient.js',timeout:5000});
const flush=async()=>{for(let k=0;k<16;k++)await Promise.resolve()};
function event(type){for(const fn of handlers.get(type)||[])fn({type,target:{}})}
function advance(ms=100){now+=ms;for(const fn of [...timers.values()])fn()}
(async()=>{
 event('click');await flush();
 assert.equal(audio.length,2);
 assert.equal(window.GitaiAmbientAudio.isPlaying(),true);
 assert.equal(audio[0].loop,true);
 const first=audio[0];
 // A healthy native loop wraps to time zero: no forced recovery.
 for(let cycle=0;cycle<3;cycle++){
  first.currentTime=10+cycle;advance(1000);
  first.currentTime=0.2;advance(1000);
  assert.equal(first.paused,false);
 }
 // WebKit reports "playing" but stops increasing currentTime.
 first.currentTime=12;advance(300);
 const before=first.plays;
 advance(2800);await flush();
 assert.ok(first.plays>before,'stalled but unpaused player must restart');
 assert.equal(first.paused,false);
 // One unresolved standby play() must not suppress every future watchdog.
 first.currentTime=25.5;advance(400);
 audio[1].pendingNextPlay=true;
 advance(100);
 await flush();
 assert.equal(first.loop,true,'audible element retains native safety loop');
 const activePlays=first.plays;
 // Hang must clear after bounded time (the native source may approach EOF).
 advance(2500);await flush();
 assert.ok(timers.size>0,'stalled overlap never kills monitoring interval');
 assert.equal(first.loop,true,'unresponsive overlap retains native fallback loop');
 first.currentTime=28.93;advance(300);await flush();
 assert.ok(first.currentTime<1,'manual EOF rewind restarts authorized player');
 assert.ok(first.plays>activePlays,'EOF fallback explicitly restarts audio');
 assert.equal(window.GitaiAmbientAudio.isPlaying(),true);
 // A real tap can also help when progress has been frozen for a while.
 first.currentTime=16;advance(100);
 advance(3100);
 const gestureBefore=first.plays;
 window.GitaiAmbientAudio.resumeFromGesture();
 await flush();
 assert.ok(first.plays>gestureBefore,'start tap must restart a frozen playback state');
 // None of these recoveries should toggle the user preference.
 assert.equal(window.GitaiAmbientAudio.isEnabled(),true);
 console.log('Exhibition iPad BGM: healthy loops, frozen currentTime, pending standby, EOF, gesture resume OK.');
})().catch(e=>{console.error(e);process.exitCode=1});
