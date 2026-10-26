'use strict';
// EV-05: exercise the real ensureConfig() from pages_preview.js in a VM.
// All JSON fixtures are current published config files; no user DB accessed.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('js/pages_preview.js','utf8');
const start=source.indexOf('  async function ensureConfig() {');
const end=source.indexOf('\n  async function ensureCurrentGeneration()',start);
assert.ok(start>=0&&end>start,'Config initializer missing');
const fn=source.slice(start,end);
assert.match(fn,/if \(configPromise\) return configPromise/);
assert.match(fn,/configPromise = null/);
assert.match(fn,/appConfig = preparedApp/);
assert.doesNotMatch(fn,/appConfig = await loadJson/);
const object=path=>JSON.parse(fs.readFileSync(path,'utf8'));
const fixtures={
 'config/konchu_univ_alpha.json':object('config/konchu_univ_alpha.json'),
 'species/moth/species.json':object('species/moth/species.json'),
 'environments/kusagi_001/environment.json':object('environments/kusagi_001/environment.json'),
 'data/evolution_models/continuous_v1/config.json':object('data/evolution_models/continuous_v1/config.json'),
 'data/evolution_models/morph_v1/config.json':object('data/evolution_models/morph_v1/config.json'),
 'config/warning_color_experiment.json':object('config/warning_color_experiment.json')
};
function create({warning=false,model='continuous_v1',query='',failAt=null,invalidAt=null}={}){
 const calls=[],mutations=new Map();
 let failed=false,fail=failAt,invalid=invalidAt;
 const ctx={
  appConfig:null,configPromise:null,speciesConfig:null,
  environmentConfig:null,evolutionConfig:null,
  WARNING_EXPERIMENT:warning,WARNING:{PER_LINEAGE:30},
  EVOLUTION_MODEL_ID:model,PREVIEW_ENV_ID:'kusagi_001',
  PREVIEW_RUN_ID:warning?'warning_color_fog_v2':'default',
  location:{search:query},URLSearchParams,JSON,Number,String,Error,
  loadJson:async(path)=>{
   calls.push(path);
   // async boundary is essential to expose premature global assignments
   await Promise.resolve();
   if(fail===path && !failed){failed=true;throw Error('Simulated 503: '+path)}
   const value=mutations.has(path)?mutations.get(path):fixtures[path];
   if(value===undefined)throw Error('Unknown fixture: '+path);
   return structuredClone(value);
  }
 };
 vm.runInNewContext(fn+'\nglobalThis.run=ensureConfig',ctx,
   {filename:'js/pages_preview.js:ensureConfig',timeout:1000});
 const allGlobals=()=>[
   ctx.appConfig,ctx.speciesConfig,ctx.environmentConfig,ctx.evolutionConfig];
 return {ctx,calls,allGlobals,run:()=>ctx.run(),
  invalidate:(path,value)=>mutations.set(path,value),
  repair:path=>{if(path===fail)fail=null;mutations.delete(path);invalid=null}
 };
}
async function transient(phase,warning) {
 const f=create({warning,failAt:phase});
 await assert.rejects(f.run(),/Simulated 503/);
 assert.deepEqual(f.allGlobals(),[null,null,null,null],
   'Every config global must remain null after failure at '+phase);
 assert.equal(f.ctx.configPromise,null,'Rejected Promise must not be cached');
 f.repair(phase);
 await f.run();
 assert.ok(f.allGlobals().every(x=>x!==null),
   'Same document must retry all dependencies after a transient error');
 assert.equal(f.ctx.appConfig.mode,'pages_preview');
 assert.equal(f.ctx.appConfig.evolution_model_id,'continuous_v1');
 assert.equal(f.ctx.appConfig.network.submit_timeout_ms,120000);
 assert.equal(f.ctx.appConfig.game.round_time_ms,4000);
 assert.equal(f.ctx.appConfig.title,fixtures['config/konchu_univ_alpha.json'].title+' — Pages Preview');
 assert.equal(f.ctx.appConfig.preview_run_id,warning?'warning_color_fog_v2':'default');
 if(warning)assert.equal(f.ctx.appConfig.warning_color.first_playable_generation,21);
 const count=f.calls.length;
 await f.run();
 assert.equal(f.calls.length,count,'Valid config must remain memoized');
}
(async()=>{
 const normal=[
  'config/konchu_univ_alpha.json',
  'species/moth/species.json',
  'environments/kusagi_001/environment.json',
  'data/evolution_models/continuous_v1/config.json'
 ];
 for(const phase of normal)await transient(phase,false);
 for(const phase of [...normal,'config/warning_color_experiment.json']) {
  await transient(phase,true);
 }
 const fast=create({query:'?fast=1'});
 await fast.run();assert.equal(fast.ctx.appConfig.game.round_time_ms,500);
 const seconds=create({query:'?seconds=2.5'});
 await seconds.run();assert.equal(seconds.ctx.appConfig.game.round_time_ms,2500);
 const concurrent=create({warning:true});
 await Promise.all([concurrent.run(),concurrent.run(),concurrent.run()]);
 assert.deepEqual(concurrent.calls,[
  ...normal,'config/warning_color_experiment.json'
 ],'Concurrent callers must share one set of fetches');
 // Malformed dependent config should not poison next attempt.
 for(const phase of normal){
  const bad=create();
  bad.invalidate(phase,null);
  await assert.rejects(bad.run(),/設定が不正/);
  assert.deepEqual(bad.allGlobals(),[null,null,null,null]);
  bad.repair(phase);
  await bad.run();
 }
 const warningBad=create({warning:true});
 const mismatch=structuredClone(fixtures['config/warning_color_experiment.json']);
 mismatch.lineage_size=99;
 warningBad.invalidate('config/warning_color_experiment.json',mismatch);
 await assert.rejects(warningBad.run(),/警戒色の実験設定が不正/);
 assert.deepEqual(warningBad.allGlobals(),[null,null,null,null]);
 warningBad.repair('config/warning_color_experiment.json');
 await warningBad.run();
 const modelMismatch=create();
 const wrongEvolution=structuredClone(fixtures['data/evolution_models/continuous_v1/config.json']);
 wrongEvolution.model_id='different';
 modelMismatch.invalidate('data/evolution_models/continuous_v1/config.json',wrongEvolution);
 await assert.rejects(modelMismatch.run(),/進化モデルIDが一致しません/);
 assert.deepEqual(modelMismatch.allGlobals(),[null,null,null,null]);
 modelMismatch.repair('data/evolution_models/continuous_v1/config.json');
 await modelMismatch.run();
 const morph=create({model:'morph_v1'});
 await morph.run();
 assert.equal(morph.ctx.appConfig.evolution_model_id,'morph_v1');
 assert.equal(morph.ctx.appConfig.network.submit_timeout_ms,120000);
 assert.equal(morph.ctx.appConfig.game.round_time_ms,4000);
 // Failed generation / submit must not create an empty save or modify DB.
 assert.doesNotMatch(fn,/idb(?:Put|Delete)|indexedDB|localStorage|Math\.random/);
 console.log('EV-05: normal/warning/morph config, 5 transient failure positions, malformed/mismatched data, concurrent init, speed overrides, retry & no writes OK');
})().catch(e=>{console.error(e);process.exitCode=1});