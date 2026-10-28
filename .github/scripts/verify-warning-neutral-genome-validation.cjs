'use strict';
// RE3-EV-01: run the ACTUAL production validator + headstart in a sterile VM.
// All stores are synthetic in-memory transactional mocks; never open a user DB.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const WARNING=require('../../js/warning_color.js');
const {createFixture}=require('./warning-headstart-idb-fixture.cjs');
const source=fs.readFileSync('js/pages_preview.js','utf8');
const config=JSON.parse(fs.readFileSync('data/evolution_models/continuous_v1/config.json','utf8'));
function extract(from,to){
 const begin=source.indexOf(from),end=source.indexOf(to,begin);
 assert.ok(begin>=0&&end>begin,'missing production function: '+from);
 return source.slice(begin,end);
}
const code=[
 extract('  function hashString32(', '\n  function inheritLinear('),
 extract('  function validateLoadedGenome(', '\n  async function loadGenomeOrInfer('),
 extract('  async function reserveWarningNeutralSeed(', '\n  function moduleMaskValue(')
].join('\n');
const headstart=extract('  async function ensureWarningNeutralHeadstart()', '\n  function moduleMaskValue(');
assert.match(headstart,/population\.set\(i, validateLoadedGenome\(genome, 'gen00001', i\)\)/);
assert.ok(headstart.indexOf('validateLoadedGenome(genome')<
  headstart.indexOf('await reserveWarningNeutralSeed('),
  'all 60 validations must run before any seed write');
assert.ok(headstart.indexOf('await reserveWarningNeutralSeed(')<
  headstart.indexOf('const genetics = evolutionConfig.trait_genetics'),
  'inheritance/offspring generation must begin only after validation');
const seed='0123456789abcdef0123456789abcdef';
const imageKey=(gen,i)=>gen+':'+String(i).padStart(2,'0');
const genomeKey=(gen,i)=>'genome:'+imageKey(gen,i);
function validFounder(i,old=false){
 const modules={};
 for(const locus of config.trait_genetics.pattern_loci){
  modules[locus.id]={
   alleles:[0,0],cx:0.5,cy:0.5,rx:0.2,ry:0.2,valueEffect:-0.2,
   hueEffect:0,saturationEffect:0,phase:0,angle:0,frequency:1,roughness:0
   // Pigment fields intentionally omitted: accepted legacy schema-1.
  };
 }
 return {schema_version:1,lineage:WARNING.lineage(i),
  baseHue:old?0:i*3,baseSaturation:0,baseValue:1,
  patternContrast:0.44,textureStrength:0,textureSeed:i+100,
  modules};
}
function setup({seedPresent=false,old=false}={}){
 const fixture=createFixture();
 fixture.stores.meta.set('current_generation_id','gen00001');
 const originals=[];
 for(let i=1;i<=60;i++){
  const g=validFounder(i,old);originals.push(g);
  fixture.stores.meta.set(genomeKey('gen00001',i),g);
  fixture.stores.images.set(imageKey('gen00001',i),new Blob(['original-'+i]));
 }
 if(seedPresent)fixture.stores.meta.set('warning_neutral_run_seed_v1',seed);
 return {fixture,originals};
}
function makeSession(fixture){
 const calls={seed:0,parents:0,offspring:0,render:0};
 const ctx={WARNING,Math,Number,Map,Set,Blob,Array,Uint8Array,Promise,
  evolutionConfig:config,appConfig:{warning_color:{independent_neutral_generations:20}},
  WARNING_EXPERIMENT:true,TOTAL:60,META_STORE:'meta',IMAGE_STORE:'images',
  loadedRestoreEpoch:null,restoreEpochCaptured:true,
  idbGet:fixture.idbGet,openDb:fixture.openDb,imageKey,genomeKey,
  ensureConfig:async()=>{},ensureMask:async()=>{},ensureTemplateAlpha:async()=>{},
  makeWarningNeutralRunSeed:()=>{calls.seed++;return seed},
  clamp01:x=>Math.max(0,Math.min(1,x)),
  generationNumber:id=>Number(id.slice(3)),
  nextGenerationId:id=>'gen'+String(Number(id.slice(3))+1).padStart(5,'0'),
  selectParents:(_eaten,indices,rng)=>{calls.parents++;rng();return [...indices]},
  buildPairingPlan:(_parents,indices,rng)=>{
   rng();return indices.map(i=>({childIndex:i,parentA:i,parentB:i}));
  },
  makeChildGenome:(a,_b,index,nextId,_x,_y,rng)=>{
   calls.offspring++;return {genome:{...a,gen:nextId,childIndex:index,
    trace:Math.round(rng()*1e6)},diagnostic:{}};
  },
  applyEntertainmentSpecialMutation:(g,_diag,_seed,rng)=>{g.trace+=Math.round(rng()*1e3)},
  renderGenome:g=>g,
  imageDataToBlob:async g=>{
   calls.render++;return new Blob([JSON.stringify([g.baseHue,g.childIndex])]);
  },
  setTimeout:callback=>queueMicrotask(callback),console
 };
 vm.runInNewContext(code+'\nglobalThis.headstart=ensureWarningNeutralHeadstart;',
  ctx,{filename:'pages_preview.js:RE3-EV-01',timeout:2000});
 return {go:()=>ctx.headstart(),calls};
}
function assertIntact(f,originals,{seedPresent}){
 assert.equal(f.stores.meta.get('current_generation_id'),'gen00001');
 assert.equal(f.stores.meta.has('warning_independent_neutral_v6'),false);
 assert.equal(f.stores.meta.has('warning_neutral_run_seed_v1'),seedPresent);
 if(seedPresent)assert.equal(f.stores.meta.get('warning_neutral_run_seed_v1'),seed);
 for(let i=1;i<=60;i++){
  assert.equal(f.stores.meta.get(genomeKey('gen00001',i)),originals[i-1]);
  assert.ok(f.stores.images.get(imageKey('gen00001',i)) instanceof Blob);
  assert.equal(f.stores.meta.has(genomeKey('gen00021',i)),false);
  assert.equal(f.stores.images.has(imageKey('gen00021',i)),false);
 }
 assert.equal(f.txLog.length,0,'invalid founders must not start a write transaction');
}
const variants=[
 ['NaN baseValue',(g)=>{g.baseValue=NaN}],
 ['Infinity baseValue',(g)=>{g.baseValue=Infinity}],
 ['string module valueEffect',(g)=>{g.modules.central_blotch.valueEffect='-0.2'}],
 ['NaN module pigmentHue',(g)=>{g.modules.central_blotch.pigmentHue=NaN}],
 ['missing locus',(g)=>{delete g.modules.cloud_mottle}],
 ['invalid allele',(g)=>{g.modules.central_blotch.alleles=[0,2]}],
 ['wrong lineage',(g)=>{g.lineage=g.lineage==='poison'?'harmless':'poison'}],
 ['missing required field',(g)=>{delete g.patternContrast}]
];
(async()=>{
 let rejections=0;
 // Corruption in any of all 60 founder slots must not cause a write or RNG draw.
 for(const [kind,mutate] of variants){
  for(let index=1;index<=60;index++){
   const {fixture,originals}=setup();
   mutate(originals[index-1]);
   const session=makeSession(fixture);
   await assert.rejects(session.go(),
    e=>typeof e?.message==='string' && e.message.includes(index+'番の蛾の遺伝情報が不正'),
    kind+' index '+index);
   assertIntact(fixture,originals,{seedPresent:false});
   assert.deepEqual(session.calls,{seed:0,parents:0,offspring:0,render:0},
    'failure must precede seed and evolution RNG');
   rejections++;
  }
 }
 // Missing saved gen1 DNA must also fail without silently inferring from PNG.
 for(const index of [1,30,60]){
  const {fixture,originals}=setup({seedPresent:true});
  fixture.stores.meta.delete(genomeKey('gen00001',index));
  const session=makeSession(fixture);
  await assert.rejects(session.go(),/遺伝情報が不正/);
  assert.equal(fixture.stores.meta.get('current_generation_id'),'gen00001');
  assert.equal(fixture.stores.meta.get('warning_neutral_run_seed_v1'),seed);
  assert.equal(fixture.txLog.length,0);
  assert.equal(session.calls.offspring,0);
 }
 // Normal new and old-H=0 founders are still accepted and use same seed.
 const evolved=[];
 for(const old of [false,true]){
  const {fixture,originals}=setup({old,seedPresent:true});
  const sess=makeSession(fixture);
  await sess.go();
  assert.equal(fixture.stores.meta.get('current_generation_id'),'gen00021');
  assert.equal(fixture.stores.meta.get('warning_neutral_run_seed_v1'),seed);
  assert.equal(fixture.stores.meta.get('warning_independent_neutral_v6'),
   'independent:20:'+config.config_id);
  assert.equal(sess.calls.offspring,1200);
  assert.equal(sess.calls.render,60);
  for(let i=1;i<=60;i++){
   assert.equal(fixture.stores.meta.get(genomeKey('gen00001',i)),originals[i-1]);
   assert.ok(fixture.stores.images.get(imageKey('gen00021',i)) instanceof Blob);
  }
  evolved.push(fixture.stores.meta.get(genomeKey('gen00021',1)).baseHue);
  const before=fixture.txLog.length;
  await sess.go();
  assert.equal(fixture.txLog.length,before,'reload should not write');
 }
 assert.notEqual(evolved[0],evolved[1]);
 // An entirely new run reserves one fresh, finite seed after validation.
 {
  const {fixture}=setup();
  const sess=makeSession(fixture);
  await sess.go();
  assert.match(fixture.stores.meta.get('warning_neutral_run_seed_v1'),/^[0-9a-f]{32}$/);
  assert.equal(fixture.stores.meta.get('current_generation_id'),'gen00021');
 }
 // Existing invalid and old optional pigment values are not normalized.
 {
  const {fixture,originals}=setup({seedPresent:true});
  originals[12].modules.central_blotch.pigmentHue=180;
  originals[12].modules.central_blotch.pigmentSaturation=0.12;
  const sess=makeSession(fixture);
  await sess.go();
  assert.equal(originals[12].modules.central_blotch.pigmentHue,180);
  assert.equal(originals[12].modules.central_blotch.pigmentSaturation,0.12);
 }
 console.log('RE3-EV-01: '+rejections+' corrupt founder placements (all 60 slots x 8 cases), missing DNA, legacy pigment omissions, new/old founder gen21; no corrupt writes/RNG; synthetic VM only.');
})().catch(e=>{console.error(e);process.exitCode=1});
