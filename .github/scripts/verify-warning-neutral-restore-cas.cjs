'use strict';
// RE3-EV-02: execute production neutral seed reservation, evolution loop and
// atomic gen21 writer in two isolated VM documents over a transactional mock.
// NO real browser profile, storage or user backup is read or modified.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {createFixture}=require('./warning-headstart-idb-fixture.cjs');
const WARNING=require('../../js/warning_color.js');
const source=fs.readFileSync('js/pages_preview.js','utf8');
const conf=JSON.parse(fs.readFileSync('data/evolution_models/continuous_v1/config.json','utf8'));
function extract(start,end){
 const a=source.indexOf(start),b=source.indexOf(end,a);
 assert.ok(a>=0&&b>a,'source markers missing '+start+' -> '+end);
 return source.slice(a,b);
}
const code=[
 extract('  function hashString32(', '\n  function inheritLinear('),
 extract('  function validateLoadedGenome(', '\n  async function loadGenomeOrInfer('),
 extract('  async function reserveWarningNeutralSeed(', '\n  function moduleMaskValue(')
].join('\n');
const startAlgo=source.indexOf('    const genetics = evolutionConfig.trait_genetics || {};',
 source.indexOf('  async function ensureWarningNeutralHeadstart()'));
const endAlgo=source.indexOf('    // Generate all PNGs in memory BEFORE opening a write transaction.',startAlgo);
assert.ok(startAlgo>0&&endAlgo>startAlgo);
const algo=source.slice(startAlgo,endAlgo);
// The audited original algorithm block (e47bf682) is unchanged byte for byte.
assert.equal(crypto.createHash('sha256').update(algo).digest('hex'),
 '87c3e086d2870492160a9fd6e71a0d199f08ead7f134b9f3dbc775724f5a83ec',
 'parent selection, inheritance, mutations and RNG call order must not change');
assert.doesNotMatch(code,/await idbPut\(/);
assert.match(code,/const tx = db.transaction\(\[IMAGE_STORE, META_STORE\], 'readwrite'\)/);
assert.match(code,/const tx = db.transaction\(META_STORE, 'readwrite'\)/);
assert.match(code,/meta\.get\('restore_epoch'\)/);
assert.match(code,/meta\.get\('current_generation_id'\)/);
const SEED='0123456789abcdef0123456789abcdef';
const key=(gen,i)=>gen+':'+String(i).padStart(2,'0');
const dnaKey=(gen,i)=>'genome:'+key(gen,i);
function founders(fixture,oldH0=false){
 const {meta,images}=fixture.stores;
 meta.set('current_generation_id','gen00001');
 for(let i=1;i<=60;i++){
  const modules={};
  for(const locus of conf.trait_genetics.pattern_loci){
   modules[locus.id]={alleles:[0,0],cx:0.5,cy:0.5,rx:0.2,ry:0.2,
    valueEffect:-0.2,hueEffect:0,saturationEffect:0,phase:0,
    angle:0,frequency:1,roughness:0};
  }
  const g={schema_version:1,lineage:WARNING.lineage(i),
   baseHue:oldH0?0:i*3,baseValue:1,baseSaturation:0,
   patternContrast:0.44,textureStrength:0,textureSeed:100+i,
   modules,trace:0};
  meta.set(dnaKey('gen00001',i),g);
  images.set(key('gen00001',i),new Blob(['original-founder-'+i]));
 }
 meta.set('warning_neutral_run_seed_v1',SEED);
}
function tab(fixture,opts={}){
 let renderCount=0,seedDraws=0;
 const ctx={
  WARNING,Math,Number,Map,Set,Blob,Array,Uint8Array,Promise,
  evolutionConfig:conf,appConfig:{warning_color:{independent_neutral_generations:20}},
  WARNING_EXPERIMENT:true,TOTAL:60,
  META_STORE:'meta',IMAGE_STORE:'images',
  restoreEpochCaptured:true,loadedRestoreEpoch:opts.epoch??null,
  idbGet:async(store,name)=>{
   if(opts.beforeRead)await opts.beforeRead(store,name);
   return fixture.idbGet(store,name);
  },openDb:fixture.openDb,
  makeWarningNeutralRunSeed:()=>{seedDraws++;return SEED;},
  ensureConfig:async()=>{},ensureMask:async()=>{},ensureTemplateAlpha:async()=>{},
  imageKey:key,genomeKey:dnaKey,
  clamp01:x=>Math.max(0,Math.min(1,x)),
  generationNumber:id=>Number(id.slice(3)),
  nextGenerationId:id=>'gen'+String(Number(id.slice(3))+1).padStart(5,'0'),
  selectParents:(_eaten,indices,rng)=>{rng();return [...indices];},
  buildPairingPlan:(_parents,indices,rng)=>{
   rng();return indices.map(i=>({childIndex:i,parentA:i,parentB:i}));
  },
  makeChildGenome:(a,b,index,nextId,_a,_b,rng)=>({
    genome:{...a,lineage:a.lineage,baseHue:a.baseHue,
     trace:(a.trace||0)+Math.round(rng()*1000000),
     childIndex:index,gen:nextId},
    diagnostic:{}
  }),
  applyEntertainmentSpecialMutation:(g,_diag,_seed,rng)=>{
   g.trace+=Math.round(rng()*1000);
  },
  renderGenome:g=>g,
  imageDataToBlob:async g=>{
   ++renderCount;
   if(opts.beforePng)await opts.beforePng(renderCount,g);
   return new Blob([JSON.stringify([g.lineage,g.baseHue,g.trace,g.childIndex])]);
  },
  setTimeout:callback=>queueMicrotask(callback),console
 };
 vm.runInNewContext(code+'\nglobalThis.headstart=ensureWarningNeutralHeadstart;',ctx,
   {filename:'pages_preview.js:RE3-EV-02',timeout:3000});
 return {go:()=>ctx.headstart(),stats:()=>({renderCount,seedDraws})};
}
async function snapshotGen(fixture,gen){
 const dna=[],images=[];
 for(let i=1;i<=60;i++){
  dna.push(fixture.stores.meta.get(dnaKey(gen,i)));
  images.push(fixture.stores.images.get(key(gen,i)));
 }
 return {dna:JSON.stringify(dna),pixels:await Promise.all(images.map(b=>b?.text()))};
}
async function assertRestored(f,gen,saved,epoch){
 assert.equal(f.stores.meta.get('current_generation_id'),gen);
 assert.equal(f.stores.meta.get('restore_epoch'),epoch);
 assert.deepEqual(await snapshotGen(f,gen),saved);
}
(async()=>{
 // Founders with new seeded latent hue and legacy H=0 both produce 60
 // deterministic images/genomes. Original founder data remains untouched.
 const positives=[];
 for(const oldH0 of [false,true]){
  const f=createFixture();founders(f,oldH0);
  const original=await snapshotGen(f,'gen00001');
  assert.equal(await tab(f).go(),true);
  assert.equal(f.stores.meta.get('current_generation_id'),'gen00021');
  assert.equal(f.stores.meta.get('warning_neutral_run_seed_v1'),SEED);
  assert.equal(f.stores.meta.get('warning_independent_neutral_v6'),
    'independent:20:'+conf.config_id);
  assert.deepEqual(await snapshotGen(f,'gen00001'),original);
  const evolved=await snapshotGen(f,'gen00021');
  assert.equal(JSON.parse(evolved.dna).length,60);
  assert.ok(evolved.pixels.every(p=>p?.startsWith('[')));
  positives.push(evolved);
  const txs=f.txLog.length;
  await tab(f).go();
  assert.equal(f.txLog.length,txs,'complete gen21 must not be regenerated');
 }
 assert.notDeepEqual(positives[0].dna,positives[1].dna);
 const repeats=[];
 for(let i=0;i<2;i++){
  const f=createFixture();founders(f);await tab(f).go();
  repeats.push(await snapshotGen(f,'gen00021'));
 }
 assert.deepEqual(repeats[0],repeats[1],'identical seed and founders are stable');

 // Seed allocation attempted after another screen restores: no seed write.
 for(const gen of ['gen00021','gen00050']){
  const f=createFixture();founders(f);
  f.stores.meta.delete('warning_neutral_run_seed_v1');
  let triggered=false;
  const t=tab(f,{beforeRead:async(_store,name)=>{
   if(!triggered&&name==='warning_neutral_run_seed_v1'){
    triggered=true;f.restore(gen,'restore-B','B');
   }
  }});
  await assert.rejects(t.go(),/復元されました/);
  assert.equal(f.stores.meta.has('warning_neutral_run_seed_v1'),false);
  assert.equal(f.stores.meta.has('warning_independent_neutral_v6'),false);
  assert.equal(f.stores.meta.get('current_generation_id'),gen);
 }

 // Restore during prep/first, middle or final PNG encoding. Reject even
 // same-generation ABA restore; all B's image and DNA records remain intact.
 for(const gen of ['gen00021','gen00050']){
  for(const phase of [1,30,60]){
   const f=createFixture();founders(f);
   let changed=false;
   const t=tab(f,{beforePng:async(i)=>{
     if(i===phase&&!changed){
      changed=true;f.restore(gen,'restore-B','B');
     }
   }});
   await assert.rejects(t.go(),/復元されました/);
   const restored=await snapshotGen(f,gen);
   await assertRestored(f,gen,restored,'restore-B');
   assert.equal(f.stores.meta.has('warning_independent_neutral_v6'),false);
   assert.equal(f.stores.meta.get('warning_neutral_run_seed_v1'),SEED);
  }
 }
 // Changing the persisted seed without changing the pointer still stops A.
 {
  const f=createFixture();founders(f);
  const t=tab(f,{beforePng:async(i)=>{
   if(i===60)f.stores.meta.set('warning_neutral_run_seed_v1','f'.repeat(32));
  }});
  await assert.rejects(t.go(),/シードが変更/);
  assert.equal(f.stores.meta.get('current_generation_id'),'gen00001');
  assert.equal(f.stores.images.has(key('gen00021',1)),false);
 }
 // Concurrent headstarts compete serially, never overwrite one another.
 {
  const f=createFixture();founders(f);
  const statuses=await Promise.allSettled([tab(f).go(),tab(f).go()]);
  assert.equal(statuses.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(statuses.filter(x=>x.status==='rejected').length,1);
  assert.equal(f.stores.meta.get('current_generation_id'),'gen00021');
  assert.equal((await snapshotGen(f,'gen00021')).pixels.length,60);
 }
 // Quota/abort midway through 120 writes must roll back ALL of them.
 {
  const f=createFixture({failAt:20});founders(f);
  const original=await snapshotGen(f,'gen00001');
  await assert.rejects(tab(f).go(),/QuotaExceeded|保存を中断/);
  assert.equal(f.stores.meta.get('current_generation_id'),'gen00001');
  assert.equal(f.stores.meta.has('warning_independent_neutral_v6'),false);
  for(let i=1;i<=60;i++){
   assert.equal(f.stores.images.has(key('gen00021',i)),false);
   assert.equal(f.stores.meta.has(dnaKey('gen00021',i)),false);
  }
  assert.deepEqual(await snapshotGen(f,'gen00001'),original);
 }
 console.log('RE3-EV-02: unchanged RNG/evolution block; new/old founders, 60 DNA/PNG, seed reservation, gen21 ABA, gen50 restore, 2 tabs, atomic quota rollback OK (synthetic VM).');
})().catch(e=>{console.error(e);process.exitCode=1;});
