'use strict';
// MODEL-01: execute the actual large-value mutation block and ensure it has
// precisely one symmetric signed step. Never load or modify any user save.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync('js/pages_preview.js','utf8');
const marker='    if (\n      rng()\n      < Number(genetics.base_value_global_mutation_p || 0)\n    ) {';
const endMark='    if (\n      rng()\n      < Number(genetics.contrast_mutation_p || 0)\n    ) {';
const a=src.indexOf(marker),b=src.indexOf(endMark,a);
assert.ok(a>0&&b>a,'expected source mutation block');
const actual=src.slice(a,b);
assert.match(actual,/sampling: 'symmetric_clamped'/);
assert.match(actual,/dark_bias_branch: false/);
assert.doesNotMatch(actual,/darkBiasP|darkExtraStep|baseValue\s*-\s*rng\(\)/);
const config=JSON.parse(fs.readFileSync('data/evolution_models/continuous_v1/config.json','utf8'));
const genetics=config.trait_genetics;
for(const name of ['base_value_dark_bias_p','base_value_dark_bias_extra_step','base_value_dark_min','base_value_dark_max']){
 assert.ok(!(name in genetics),'obsolete dark-only policy still exists: '+name);
}
assert.equal(genetics.base_value_global_mutation_p,0.009);
assert.equal(genetics.base_value_global_mutation_step,0.24);
assert.equal(genetics.base_value_global_min,0.10);
assert.equal(genetics.base_value_global_max,0.95);
function run(value,stepRandom,prob=1){
 let calls=0;const rngVals=[0,stepRandom],context={
  rng:()=>{assert.ok(calls<rngVals.length,'no extra dark-only RNG calls');return rngVals[calls++];},
  genetics:{...genetics,base_value_global_mutation_p:prob},
  baseValue:value,
  clamp:(x,min,max)=>Math.min(max,Math.max(min,x)),
  diagnosticNumber:(v,d)=>Number(v.toFixed(d)),
  diagnostic:{mutations:[]},
  Number,Math
 };
 vm.runInNewContext(actual,context,{filename:'js/pages_preview.js:base_value_global',timeout:2000});
 return {after:context.baseValue,calls,event:context.diagnostic.mutations[0]};
}
const low=run(0.5,0.2),high=run(0.5,0.8);
assert.equal(low.calls,2);assert.equal(high.calls,2);
assert.ok(Math.abs((0.5-low.after)-(high.after-0.5))<1e-12,
 'negative and positive equal-magnitude steps must be symmetric');
assert.equal(low.event.sampling,'symmetric_clamped');
assert.equal(high.event.dark_bias_branch,false);
assert.ok(run(0.5,0.5).after===0.5);
assert.equal(run(0.5,0).after,0.26);
assert.equal(run(0.5,0.999999).calls,2);
assert.ok(run(0.94,0.99).after<=0.95,'existing upper bound preserved');
assert.ok(run(0.11,0.01).after>=0.1,'existing lower bound preserved');
const exhibit=fs.readFileSync('exhibit/build.py','utf8');
assert.match(exhibit,/EXHIBIT_MUTATION_RATE_FACTOR = 0\.5/);
assert.ok(exhibit.includes("key.endsWith('_p')"),
 'exhibit per-event probability scale left untouched');
console.log('MODEL-01: original value mutation is symmetric in the interior; dark-only RNG draw removed; old bounds/probabilities and exhibit factor preserved.');
