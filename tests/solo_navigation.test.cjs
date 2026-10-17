'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const portal=fs.readFileSync(path.join(root,'js/entertainment_portal.js'),'utf8');
function getFragment(src,start,end){
 const a=src.indexOf(start),b=src.indexOf(end,a+1);
 assert.ok(a>=0&&b>a,'Missing fragment: '+start);
 return src.slice(a,b);
}
const navigation=getFragment(html,'  function scheduleInterRound(delay) {','  function shuffle(array) {');
function harness({playing=true,now=2000,roundStart=1000,delay=4000}={}){
 const state={
   soloPaused:false,roundActive:playing,roundStartedAt:roundStart,
   remainingSeconds:0,countdownIntervalId:11,roundTimeoutId:12,
   hitEffectFrameId:null,hitEffects:[],
   interRoundTimeoutId:playing?null:14,interRoundDueAt:now+delay,
   pausedRoundRemainingMs:null,pausedInterRoundRemainingMs:null,
   uiTransitionLocked:true
 };
 const calls=[],events={};
 const context={
   state,CONFIG:{ROUND_TIME_MS:4000},performance:{now:()=>now},
   isEntertainmentModel:()=>true,clearTimers:()=>{state.countdownIntervalId=null;state.roundTimeoutId=null;calls.push(['clearRoundTimers']);},
   cancelAnimationFrame:(id)=>calls.push(['cancelFrame',id]),
   clearTimeout:(id)=>calls.push(['clearTimeout',id]),
   setTimeout:(fn,delay)=>{calls.push(['timeout',delay]);return 42;},
   setInterval:(fn,delay)=>{calls.push(['interval',delay]);return 41;},
   render:()=>calls.push(['render']),endRound:()=>{},
   startRound:()=>calls.push(['startRound']),
   window:{addEventListener:(name,fn)=>events[name]=fn}
 };
 const f=new Function(...Object.keys(context),navigation+';return {pauseSolo,resumeSolo};');
 const methods=f(...Object.values(context));
 return {state,calls,events,methods,setNow(value){now=value;}};
}
test('Result and in-game navigation have separate leave-without-reset actions',()=>{
 assert.match(html,/id="soloHomeButton"[^>]+hidden/);
 assert.match(html,/id="resultBackToMenu"[^>]+hidden/);
 assert.match(portal,/resultBackToMenu\.addEventListener\('click', returnToMenuWithoutReset\)/);
 assert.match(portal,/soloHomeButton\.addEventListener\('click', returnToMenuWithoutReset\)/);
 assert.match(portal,/window\.dispatchEvent\(new Event\('gitai:solo-pause'\)\)/);
 assert.match(portal,/window\.dispatchEvent\(new Event\('gitai:solo-resume'\)\)/);
 assert.doesNotMatch(navigation,/resetAll|deleteDatabase|localStorage\.clear/);
});
test('a mid-round pause and resume preserves the same round and correct remaining time',()=>{
 const h=harness({now:3000,roundStart:1000});
 h.methods.pauseSolo();
 assert.equal(h.state.soloPaused,true);
 assert.equal(h.state.pausedRoundRemainingMs,2000);
 assert.equal(h.state.roundActive,true);
 assert.ok(h.calls.find(([what])=>what==='clearRoundTimers'));
 h.setNow(23000);
 h.methods.resumeSolo();
 assert.equal(h.state.soloPaused,false);
 assert.equal(h.state.roundStartedAt,21000);
 assert.equal(h.state.currentRoundIndex,undefined);
 assert.equal(h.state.remainingSeconds,2);
 assert.ok(h.calls.some(([what,delay])=>what==='timeout'&&delay===2000));
 assert.ok(h.calls.some(([what,delay])=>what==='interval'&&delay===1000));
});
test('pausing between rounds prevents next round from starting behind the menu',()=>{
 const h=harness({playing:false,now:2000,delay:650});
 h.methods.pauseSolo();
 assert.equal(h.state.soloPaused,true);
 assert.equal(h.state.pausedInterRoundRemainingMs,650);
 assert.ok(h.calls.some(([what,id])=>what==='clearTimeout'&&id===14));
 h.setNow(50000);
 h.methods.resumeSolo();
 assert.ok(h.calls.some(([what,delay])=>what==='timeout'&&delay===650));
 assert.equal(h.state.roundActive,false);
 assert.equal(h.state.pausedInterRoundRemainingMs,null);
});
test('direct ?play=1 routes still initialize the return-to-menu handler',()=>{
 assert.match(portal,/const directSolo = params\.get\('play'\) === '1'/);
 assert.doesNotMatch(portal,/model !== 'continuous_v1' \|\| params\.get\('play'\) === '1'/);
 assert.match(portal,/portal\.hidden = directSolo/);
 assert.match(portal,/setMode\(directSolo \|\|/);
 assert.match(html,/js\/entertainment_portal\.js\?v=20261017-solo-home1/);
});
