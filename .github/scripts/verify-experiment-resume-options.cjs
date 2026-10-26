'use strict';
// EV-07: execute the actual saved experiment URL codec. No IndexedDB changes.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('js/experiment_saves.js','utf8');
const start=source.indexOf('  function effectivePlayOverrides(');
const end=source.indexOf('\n  function newId(',start);
assert.ok(start>0 && end>start,'settings serializer was not found');
const code=source.slice(start,end);
function codec(query,{warning=true}={}){
 const params=new URLSearchParams(query);
 const ctx={
   URL,URLSearchParams,
   params,warning,
   context:{environmentId:'kusagi_001',evolutionModelId:'continuous_v1'},
   location:{pathname:'/Gitai_Lab_Preview/',origin:'https://example.test'}
 };
 vm.runInNewContext(code+'\nglobalThis.getConfig=configFromPage;\nglobalThis.resume=urlFor;',
   ctx,{filename:'js/experiment_saves.js:EV-07',timeout:3000});
 const config=JSON.parse(JSON.stringify(ctx.getConfig()));
 return {config,urlFor:c=>new URL(ctx.resume(c))};
}
const base='?model=continuous_v1&env=kusagi_001&run=warning_color_fog_v2&experiment=warning_color&fog=1&slot=slot2';
for(const seconds of ['0.5','10','4.125']){
 const codec1=codec(base+'&seconds='+seconds);
 assert.equal(codec1.config.seconds,seconds);
 const u=codec1.urlFor(codec1.config);
 assert.equal(u.searchParams.get('seconds'),seconds);
 assert.equal(u.searchParams.get('run'),'warning_color_fog_v2');
 assert.equal(u.searchParams.get('slot'),'slot2');
 assert.equal(u.searchParams.get('play'),'1');
}
const fast=codec(base+'&fast=1');
assert.equal(fast.config.fast,'1');
assert.equal(fast.urlFor(fast.config).searchParams.get('fast'),'1');
assert.equal(fast.urlFor(fast.config).searchParams.has('seconds'),false);
const priority=codec(base+'&seconds=2&fast=1');
assert.equal(priority.config.seconds,'2');
assert.equal(priority.config.fast,'');
assert.equal(priority.urlFor(priority.config).searchParams.has('fast'),false);
for(const life of ['0','1']){
 const c=codec(base+'&life='+life);
 assert.equal(c.config.life,life);
 assert.equal(c.urlFor(c.config).searchParams.get('life'),life);
}
const standard=codec('?model=continuous_v1&env=kusagi_001&run=myrun&fast=1&life=0',{warning:false});
assert.equal(standard.urlFor(standard.config).searchParams.get('fast'),'1');
assert.equal(standard.urlFor(standard.config).searchParams.has('life'),false);
for(const value of ['-1','0.49','11','Infinity','bad','']){
 const c=codec(base+'&seconds='+encodeURIComponent(value));
 assert.equal(c.urlFor(c.config).searchParams.has('seconds'),false);
}
const fallback=codec(base+'&seconds=invalid&fast=1');
assert.equal(fallback.urlFor(fallback.config).searchParams.get('fast'),'1');
const missing=codec(base);
assert.equal(missing.urlFor(missing.config).searchParams.has('seconds'),false);
assert.equal(missing.urlFor(missing.config).searchParams.has('fast'),false);
assert.equal(missing.urlFor(missing.config).searchParams.has('life'),false);
// Records created by older versions have no override keys. Those use existing
// default game config and fog v2's default life=10 without adding URL overrides.
const legacy=missing.urlFor({
 env:'kusagi_001',model:'continuous_v1',run:'warning_color_fog_v2',
 experiment:'warning_color',fog:'1',slot:'old-slot'
});
assert.equal(legacy.searchParams.has('life'),false);
assert.equal(legacy.searchParams.has('seconds'),false);
assert.equal(legacy.searchParams.has('fast'),false);
assert.equal(legacy.searchParams.get('slot'),'old-slot');
const dangerous=missing.urlFor({
 env:'kusagi_001',model:'continuous_v1',run:'warning_color_fog_v2',
 experiment:'warning_color',fog:'1',slot:'x',
 seconds:'999',fast:'0',life:'anything'
});
assert.equal(dangerous.searchParams.has('seconds'),false);
assert.equal(dangerous.searchParams.has('fast'),false);
assert.equal(dangerous.searchParams.has('life'),false);
console.log('EV-07: seconds 0.5/10/decimals, fast fallback, life 0/1, invalid controls, legacy defaults and slot identity OK.');
