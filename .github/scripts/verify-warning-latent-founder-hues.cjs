'use strict';
// MODEL-03: real seeded warning founder hue initialization, and the real
// warning 20-generation bootstrap reading preserved gen1 genomes.
// All files/DB and offspring genetics are mocks; no user saves are touched.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const WARNING=require('../../js/warning_color.js');
const {createFixture}=require('./warning-headstart-idb-fixture.cjs');
const source=fs.readFileSync('js/pages_preview.js','utf8');
const config=JSON.parse(fs.readFileSync('data/evolution_models/continuous_v1/config.json','utf8'));
const begin=(start,end)=>{
 const a=source.indexOf(start),b=source.indexOf(end,a);
 assert.ok(a>=0&&b>a,'source markers: '+start+' to '+end);
 return source.slice(a,b);
};
const actual=[
 begin('  function hashString32(', '\n  function inheritLinear('),
 begin('  function makePureWhiteFounderGenome(', '\n  function randomRange('),
 begin('  function validateLoadedGenome(', '\n  async function loadGenomeOrInfer('),
 begin('  async function reserveWarningNeutralSeed(', '\n  function moduleMaskValue(')
].join('\n');
assert.match(actual,/makeWarningWhiteFounderGenome\(index\)/);
assert.match(actual,/genome\.baseHue = makeSeededRng\(/);
assert.match(actual,/genomeKey\('gen00001', i\)/);
assert.match(source,/genome = makeWarningWhiteFounderGenome\(i\)/);
const mutedConfig=JSON.parse(JSON.stringify(config));
const fixture=createFixture();
const data=fixture.stores.meta;
const images=fixture.stores.images;
let writes=[];
const globals={
 WARNING,Math,Number,Map,Set,Blob,Array,Uint8Array,Promise,
 evolutionConfig:mutedConfig,appConfig:{warning_color:{independent_neutral_generations:20}},
 WARNING_EXPERIMENT:true,TOTAL:60,
 META_STORE:'meta',IMAGE_STORE:'images',
 defaultModuleParams:()=>({cx:0.5,cy:0.5,rx:0.2,ry:0.2,valueEffect:-0.2}),
 genomeKey:(generation,index)=>'genome:'+generation+':'+String(index).padStart(2,'0'),
 imageKey:(generation,index)=>generation+':'+String(index).padStart(2,'0'),
 idbGet:fixture.idbGet,openDb:fixture.openDb,
 loadedRestoreEpoch:null,restoreEpochCaptured:true,
 ensureConfig:async()=>{},ensureMask:async()=>{},ensureTemplateAlpha:async()=>{},
 makeWarningNeutralRunSeed:()=>{throw Error('unexpected new seed draw')},
 clamp01:x=>Math.min(1,Math.max(0,x)),
 generationNumber:id=>Number(id.slice(3)),
 nextGenerationId:id=>'gen'+String(Number(id.slice(3))+1).padStart(5,'0'),
 // Isolate the origin of every offspring without testing other evolution code:
 selectParents:(_eaten,indices)=>indices,
 buildPairingPlan:(_parents,indices)=>indices.map(i=>({childIndex:i,parentA:i,parentB:i})),
 makeChildGenome:(parentA,parentB,childIndex)=>({
   genome:{...parentA,modules:parentA.modules,childIndex},
   diagnostic:{mutations:[]}
 }),
 applyEntertainmentSpecialMutation(){},
 renderGenome:genome=>genome,
 imageDataToBlob:async genome=>new Blob([JSON.stringify({h:genome.baseHue})]),
 setTimeout:callback=>queueMicrotask(callback),
 console
};
vm.runInNewContext(actual+'\nglobalThis.__test={create:makeWarningWhiteFounderGenome,headstart:ensureWarningNeutralHeadstart};',
 globals,{filename:'js/pages_preview.js:MODEL-03',timeout:5000});
const create=index=>globals.__test.create(index);
const generated=Array.from({length:60},(_,i)=>create(i+1));
const hue=new Set();
for(let i=1;i<=60;i++){
 const g=generated[i-1];
 assert.equal(g.schema_version,1);
 assert.equal(g.baseSaturation,0,'each initial moth stays white');
 assert.equal(g.baseValue,1,'white founder brightness unchanged');
 assert.equal(g.lineage,i<=30?'poison':'harmless');
 assert.ok(g.baseHue>=0&&g.baseHue<360,'latent hue within 360 degrees');
 assert.equal(create(i).baseHue,g.baseHue,'same founder index is deterministic');
 for(const module of Object.values(g.modules))assert.deepEqual(Array.from(module.alleles),[0,0]);
 hue.add(g.baseHue);
}
assert.ok(hue.size>=58,'60 white founders must not collapse to one latent red hue');
assert.ok(generated.slice(0,30).some(g=>g.baseHue>120&&g.baseHue<240),
 'poison founders contain hues outside red');
assert.ok(generated.slice(30).some(g=>g.baseHue>120&&g.baseHue<240),
 'harmless founders contain hues outside red');

const probabilities=JSON.stringify(mutedConfig.trait_genetics);
async function doHeadstart(founders){
 data.clear();images.clear();writes=[];
 data.set('current_generation_id','gen00001');
 for(let i=1;i<=60;i++)data.set(globals.genomeKey('gen00001',i),founders[i-1]);
 data.set('warning_neutral_run_seed_v1','0123456789abcdef0123456789abcdef');
 assert.equal(await globals.__test.headstart(),true);
 assert.equal(data.get('current_generation_id'),'gen00021');
 assert.equal(data.get('warning_independent_neutral_v6'),
   'independent:20:'+config.config_id);
 for(let i=1;i<=60;i++){
   const savedFounder=data.get(globals.genomeKey('gen00001',i));
   const evolved=data.get(globals.genomeKey('gen00021',i));
   assert.equal(savedFounder,founders[i-1],'gen1 DNA is never overwritten');
   assert.equal(evolved.baseHue,savedFounder.baseHue,
     'neutral headstart starts from actual saved gen1 DNA');
   assert.ok(images.get(globals.imageKey('gen00021',i)) instanceof Blob);
 }
 assert.ok(![...data.keys()].some(key=>key.startsWith('genome:gen00001:') && !founders.some((g,j)=> j+1===Number(key.slice(-2)) && data.get(key)===g)),
   'never write to existing first-generation genomes');
 const previous=fixture.txLog.length;
 assert.equal(await globals.__test.headstart(),true,'reload existing gen21');
 assert.equal(fixture.txLog.length,previous,'gen21+ should not be recomputed on reload');
}
(async()=>{
 await doHeadstart(generated);
 const old=generated.map(g=>({...g,baseHue:0}));
 await doHeadstart(old);
 for(let i=1;i<=60;i++)assert.equal(data.get(globals.genomeKey('gen00021',i)).baseHue,0,
  'interrupted old H=0 run cannot be secretly changed to new hue policy');
 data.clear();images.clear();writes=[];
 data.set('current_generation_id','gen00001');
 for(let i=1;i<=60;i++)data.set(globals.genomeKey('gen00001',i),generated[i-1]);
 data.delete(globals.genomeKey('gen00001',42));
 data.set('warning_neutral_run_seed_v1','0123456789abcdef0123456789abcdef');
 await assert.rejects(globals.__test.headstart(),/42番の蛾の遺伝情報が不正/);
 assert.equal(data.get('current_generation_id'),'gen00001');
 assert.equal(data.has(globals.genomeKey('gen00021',1)),false);
 assert.equal(JSON.stringify(mutedConfig.trait_genetics),probabilities,
   'mutation probability and range settings unchanged');
 assert.equal(config.founder_model.warning_latent_hue_mode,
  'uniform_generation1_seeded_per_individual');
 console.log('MODEL-03: 60 white founders have reproducible individual latent hues; new/old gen1 DNA preserved through neutral headstart, absent founder fails without children or mutation-rate changes.');
})().catch(err=>{console.error(err);process.exitCode=1});
