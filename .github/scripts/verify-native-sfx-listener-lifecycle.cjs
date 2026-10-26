'use strict';
// PF01: execute the native voice management from js/game_sfx.js, isolated
// from the user's audio hardware, browsing data and evolution RNG.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('js/game_sfx.js','utf8');
const first=source.indexOf('  function releaseNative(');
const middle=source.indexOf('  function playBuffer(',first);
const second=source.indexOf('  function playNative(');
const last=source.indexOf('  function play(kind)',second);
assert.ok(first>0 && middle>first && second>middle && last>second);
const body=source.slice(first,middle)+'\n'+source.slice(second,last);
assert.match(body,/player\.removeEventListener\('ended', item\.onEnded\)/);

function harness(){
 const players=new Map(), promises=[];
 const live=[],liveNative=[];
 let response='resolve';
 class Player{
   constructor(name){this.name=name;this.listeners=new Set();this.pauseCount=0;this.currentTime=0;this.active=false;}
   addEventListener(kind,fn){assert.equal(kind,'ended');this.listeners.add(fn);}
   removeEventListener(kind,fn){assert.equal(kind,'ended');this.listeners.delete(fn);}
   pause(){this.pauseCount++;this.active=false;}
   play(){
     if(response==='throw')throw Error('TEST_PLAY_THROW');
     this.active=true;
     if(response==='reject')return Promise.reject(Error('TEST_PLAY_REJECT'));
     if(response==='delay')return new Promise((resolve,reject)=>promises.push({resolve,reject,player:this}));
     return Promise.resolve();
   }
   ended(){for(const fn of [...this.listeners]){this.listeners.delete(fn);fn();}}
 }
 const entries=new Map();
 function ensureNative(kind,n){
   const key=kind+'_'+n;
   if(!entries.has(key)){
     const list=[0,1].map(i=>new Player(key+':'+i));
     list.forEach(p=>players.set(p.name,p));
     entries.set(key,{list,next:0});
   }
   return entries.get(key);
 }
 const context={ensureNative,live,liveNative,MAX_VOICES:8};
 vm.runInNewContext(body+
  '\nglobalThis.play=playNative;globalThis.stop=stopKind;',
  context,{filename:'js/game_sfx.js:PF01',timeout:4000});
 return {ctx:context,liveNative,players,promises,entry:ensureNative,
   play:(kind,n)=>context.play(kind,n),stop:kind=>context.stop(kind),
   mode:value=>{response=value},
   listenerCount:()=>[...players.values()].reduce((n,p)=>n+p.listeners.size,0)};
}
(async()=>{
 const rejects=harness();
 rejects.mode('reject');
 for(let i=0;i<1000;i++)rejects.play('capture',1);
 await Promise.resolve();await Promise.resolve();
 assert.equal(rejects.liveNative.length,0);
 assert.equal(rejects.listenerCount(),0,'1000 rejected plays cannot accumulate handlers');
 const thrown=harness();thrown.mode('throw');
 for(let i=0;i<1000;i++)thrown.play('capture',1);
 assert.equal(thrown.listenerCount(),0);
 const reused=harness();
 for(let i=0;i<1000;i++)reused.play('capture',1);
 assert.equal(reused.liveNative.length,2,'two reusable native elements');
 assert.equal(reused.listenerCount(),2,'at most one ended listener per player');
 reused.entry('capture',1).list[0].ended();
 assert.equal(reused.liveNative.length,1);
 assert.equal(reused.listenerCount(),1);
 reused.stop('capture');
 assert.equal(reused.liveNative.length,0);
 assert.equal(reused.listenerCount(),0);
 const stopped=harness();
 stopped.play('poison',1);
 stopped.play('death',1);
 assert.equal(stopped.listenerCount(),2);
 stopped.stop('poison');
 assert.equal(stopped.liveNative.length,1,'stopping poison must retain death');
 assert.equal(stopped.listenerCount(),1);
 stopped.stop('death');
 assert.equal(stopped.listenerCount(),0);
 const capped=harness();
 for(let i=1;i<=10;i++)capped.play('capture',i);
 assert.equal(capped.liveNative.length,8);
 assert.equal(capped.listenerCount(),8,'voice limit also bounds listeners');
 assert.equal(capped.entry('capture',1).list[0].listeners.size,0,'evicted voice listener removed');
 const delayed=harness();delayed.mode('delay');
 delayed.play('capture',1);
 const old=delayed.promises[0];
 delayed.play('capture',1);
 delayed.play('capture',1); // same native player reused while old Promise is pending
 assert.equal(delayed.liveNative.length,2);
 assert.equal(delayed.listenerCount(),2);
 old.reject(Error('late rejection from a reused voice'));
 await Promise.resolve();await Promise.resolve();
 assert.equal(delayed.liveNative.length,2,'late failure may not remove newer playback');
 assert.equal(delayed.listenerCount(),2,'late failure may not detach newer handler');
 const player=delayed.entry('capture',1).list[0];
 player.ended();
 assert.equal(delayed.liveNative.length,1);
 assert.equal(delayed.listenerCount(),1);
 console.log('PF01: 1000 rejects/reuses/throws, natural ended, stopKind, delayed stale failure, 8-voice cap verified.');
})().catch(e=>{console.error(e);process.exitCode=1;});
