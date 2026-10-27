'use strict';
// EV-01: run the actual ensureCurrentGeneration() from pages_preview.js
// in isolated VM fixtures. No browser IndexedDB or user saves are accessed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/pages_preview.js', 'utf8');
const start = source.indexOf('  async function ensureCurrentGeneration() {');
const stop = source.indexOf('\n  function resolveAsset(', start);
assert.ok(start >= 0 && stop > start, 'Current generation function not found');
const original = source.slice(start, stop);
assert.match(original, /hasStoredGeneration/, 'Must distinguish old run and first launch');
assert.doesNotMatch(original, /idbPut\(META_STORE,\s*'current_generation_id'/,
  'An image read failure must never rewrite generation pointer');

const TOTAL = 60;
function fixture({stored, missing = [], warning = false, newRun = false, bootstrapError = false} = {}) {
  const meta = new Map();
  if (!newRun) meta.set('current_generation_id', stored);
  const images = new Map();
  const events = {writes:[],founder:0,neutral:0,loaded:[],snapshots:[]};
  function fill(gen, omit=[]) {
    const indices = new Set(Array.from({length:TOTAL},(_,i)=>i+1));
    for (const idx of omit) indices.delete(idx);
    images.set(gen, indices);
  }
  if (!newRun && typeof stored === 'string' && /^gen\d{5}$/.test(stored)) {
    fill(stored, missing);
  }
  const context = {
    META_STORE:'meta', WARNING_EXPERIMENT:warning, console:{error(){}},
    currentGenerationId:'gen00001',
    restoreEpochCaptured:false,loadedRestoreEpoch:null,
    ensureConfig:async()=>{},
    idbGet:async(store,key)=>meta.get(key),
    idbPut:async(store,key,value)=>{events.writes.push({store,key,value});meta.set(key,value)},
    usesBrowserGeneratedFounder:()=>true,
    ensureFounderGeneration:async()=>{
      events.founder++;
      if (bootstrapError) throw Error('QuotaExceededError');
      fill('gen00001');
      meta.set('current_generation_id','gen00001');
    },
    ensureWarningNeutralHeadstart:async()=>{
      events.neutral++;
      fill('gen00021');
      context.currentGenerationId='gen00021';
      meta.set('current_generation_id','gen00021');
    },
    loadGeneratedGeneration:async gen=>{
      events.loaded.push(gen);
      return images.get(gen)?.size === TOTAL;
    },
    ensureTheaterSnapshot:async gen=>{events.snapshots.push(gen)}
  };
  vm.runInNewContext(original + '\nglobalThis.invokeCurrent=ensureCurrentGeneration;\n',
    context,{filename:'js/pages_preview.js:ensureCurrentGeneration',timeout:1000});
  return {context,events,meta,images,run:()=>context.invokeCurrent()};
}
async function corruptPersistedGeneration(gen, missing, warning=false) {
  const f=fixture({stored:gen,missing,warning});
  await assert.rejects(f.run(), /画像が不足|蛾画像が揃っていません/);
  assert.equal(f.meta.get('current_generation_id'),gen,
    'The original generation pointer must not be replaced');
  assert.deepEqual(f.events.writes,[], 'No existing metadata writes during recovery');
  assert.equal(f.events.founder,0, 'No silent founding when a run is broken');
  assert.equal(f.events.neutral,0, 'No warning headstart on a broken gen21+');
  assert.deepEqual(f.events.snapshots,[], 'Do not generate theater from corrupt data');
}
(async()=>{
  // First, middle, final and all-image loss, in the same saved generation.
  for(const missing of [[1],[31],[60],Array.from({length:TOTAL},(_,i)=>i+1)]) {
    await corruptPersistedGeneration('gen00234',missing,false);
    await corruptPersistedGeneration('gen00021',missing,true);
  }
  await corruptPersistedGeneration('gen00001',[1],false);
  await corruptPersistedGeneration('gen00001',[60],true);
  // The legitimate existing run must load without creating new founders.
  const complete=fixture({stored:'gen00234'});
  await complete.run();
  assert.equal(complete.context.currentGenerationId,'gen00234');
  assert.equal(complete.events.founder,0);
  assert.deepEqual(complete.events.writes,[]);
  // New-run creation still starts the founder once and preserves new-run flow.
  const fresh=fixture({newRun:true});
  await fresh.run();
  assert.equal(fresh.events.founder,1);
  assert.equal(fresh.context.currentGenerationId,'gen00001');
  const freshWarning=fixture({newRun:true,warning:true});
  await freshWarning.run();
  assert.equal(freshWarning.events.founder,1);
  assert.equal(freshWarning.events.neutral,1);
  assert.equal(freshWarning.context.currentGenerationId,'gen00021');
  // Resume a valid gen1 warning neutral bootstrap; do not overwrite gen1.
  const validGenOne=fixture({stored:'gen00001',warning:true});
  await validGenOne.run();
  assert.equal(validGenOne.events.founder,0);
  assert.equal(validGenOne.events.neutral,1);
  const invalid=fixture({stored:'not-a-generation'});
  await assert.rejects(invalid.run(),/世代IDが不正/);
  assert.equal(invalid.meta.get('current_generation_id'),'not-a-generation');
  assert.equal(invalid.events.founder,0);
  const quota=fixture({newRun:true,bootstrapError:true});
  await assert.rejects(quota.run(),/QuotaExceededError/);
  assert.equal(quota.meta.has('current_generation_id'),false);
  assert.deepEqual(quota.events.writes,[]);
  console.log('EV-01: No implicit reset on missing first/middle/last/all images, valid old/new/warning runs unchanged, invalid pointer and quota safely fail.');
})().catch(e=>{console.error(e);process.exitCode=1});
