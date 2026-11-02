'use strict';
// Verify the actual standalone iOS diagnostic distinguishes 4s->0s from
// a correct 45s->0s transition. No game state or real storage is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.argv[2] || '_site';
const folder = path.join(root,'exhibit');
const html = fs.readFileSync(path.join(folder,'bgm_diagnostic.html'),'utf8');
const js = fs.readFileSync(path.join(folder,'bgm_diagnostic.js'),'utf8');
const game = fs.readFileSync(path.join(folder,'game.html'),'utf8');
const modes = fs.readFileSync(path.join(folder,'modes.html'),'utf8');
const assets = JSON.parse(fs.readFileSync(path.join(folder,'precache.json'),'utf8'));
assert.match(html,/bgm_diagnostic\.js/);
assert.ok(assets.includes('bgm_diagnostic.html'));
assert.ok(assets.includes('bgm_diagnostic.js'));
assert.ok(assets.includes('audio/gitailab_rainforest_ios_seamless_loop_48k.m4a'));
assert.doesNotMatch(game,/bgm_diagnostic/);
assert.doesNotMatch(modes,/bgm_diagnostic/);
assert.doesNotMatch(js,/indexedDB\.(?:open|deleteDatabase)|localStorage|sessionStorage/);
assert.doesNotMatch(js,/fetch\(|sendBeacon\(|XMLHttpRequest/);
assert.match(js,/UNEXPECTED_EARLY_WRAP/);
const listeners = new Map();
const makeElement = () => ({
 textContent:'',value:'',hidden:true,
 addEventListener(name,callback){listeners.set(this.id+':'+name,callback)},
 focus(){},select(){}
});
const elements = {};
for(const id of ['native','manual','stop','player','status','alert','log-text','recent','copy','copy-status'])
 elements[id] = Object.assign(makeElement(),{id});
const audio = elements.player;
audio.duration=45;
audio.currentTime=0;
audio.paused=true;
audio.ended=false;
audio.readyState=4;
audio.networkState=1;
audio.seeking=false;
audio.buffered={length:0};
audio.events=new Map();
audio.addEventListener=(name,cb)=>{
 if(!audio.events.has(name))audio.events.set(name,[]);
 audio.events.get(name).push(cb);
};
audio.fire=(name)=>{for(const cb of audio.events.get(name)||[])cb();};
audio.play=()=>{audio.paused=false;audio.fire('playing');return Promise.resolve()};
audio.pause=()=>{audio.paused=true;audio.fire('pause')};
audio.load=()=>{};
audio.removeAttribute=()=>{};
const document={
 hidden:false,
 getElementById:id=>elements[id],
 addEventListener:(event,cb)=>listeners.set('document:'+event,cb)
};
const reports=[];
const clipboard={writeText:async value=>{reports.push(value)}};
const window={addEventListener:(event,cb)=>listeners.set('window:'+event,cb)};
const sandbox={document,window,navigator:{userAgent:'iPhone test',audioSession:{type:'playback'},clipboard},Date,Number,Promise,console,location:{pathname:'/exhibit/bgm_diagnostic.html'},setInterval:()=>1};
vm.runInNewContext(js,sandbox,{filename:'bgm_diagnostic.js',timeout:4000});
(async()=>{
 listeners.get('native:click')();
 await Promise.resolve();
 audio.currentTime=1.1;audio.fire('timeupdate');
 audio.currentTime=4.1;audio.fire('timeupdate');
 audio.currentTime=0.12;audio.fire('timeupdate');
 assert.equal(elements.alert.hidden,false,'early 4s loop should show warning');
 assert.match(elements.recent.textContent,/UNEXPECTED_EARLY_WRAP/);
 audio.currentTime=44.8;audio.fire('timeupdate');
 audio.currentTime=0.2;audio.fire('timeupdate');
 assert.match(elements.recent.textContent,/NORMAL_END_WRAP/);
 assert.match(elements.status.textContent,/途中での巻き戻り: 1 回/);
 assert.match(elements.status.textContent,/正常な終端ループ: 1 回/);
 await listeners.get('copy:click')();
 assert.ok(reports.length===1);
 assert.match(reports[0],/GITAI_LAB_BGM_LOOP_DIAGNOSTIC_V1/);
 assert.match(reports[0],/UNEXPECTED_EARLY_WRAP/);
 assert.match(reports[0],/NORMAL_END_WRAP/);
 listeners.get('manual:click')();
 await Promise.resolve();
 assert.equal(audio.loop,false);
 const plays={count:0};
 audio.play=()=>{plays.count++;return Promise.resolve()};
 audio.currentTime=44.9;audio.fire('ended');
 await Promise.resolve();
 assert.equal(audio.currentTime,0);
 assert.equal(plays.count,1,'manual mode replay occurs only on ended');
 assert.equal(sandbox.indexedDB,undefined);
 console.log('Exhibition BGM diagnostic: 4s abnormal wraps, 45s normal wraps, copy, manual mode, offline and save isolation OK');
})().catch(error=>{console.error(error);process.exitCode=1});