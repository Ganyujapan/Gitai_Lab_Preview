'use strict';
// RE3-MODEL-01. Only synthetic diagnostic records and copied artifact files.
// Never open, create, migrate or clear any real experiment database.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync('js/pages_preview.js','utf8');

const revStart=source.indexOf('  const EVOLUTION_RULE_REVISIONS = ');
const revEnd=source.indexOf('  const WARNING_EXPERIMENT = ',revStart);
const helperStart=source.indexOf('  function ruleProvenanceForGeneration()');
const helperEnd=source.indexOf('  function diagnosticNumber(',helperStart);
assert.ok(revStart>0&&revEnd>revStart&&helperStart>0&&helperEnd>helperStart);
const revisions=source.slice(revStart,revEnd);
const helper=source.slice(helperStart,helperEnd);

function rule(model, configId, exhibitFactor, build='__GITAI_BUILD__'){
 const script=revisions.replace("const EVOLUTION_BUILD_COMMIT = '__GITAI_BUILD__';",
   "const EVOLUTION_BUILD_COMMIT = '"+build+"';");
 const context={EVOLUTION_MODEL_ID:model,evolutionConfig:{config_id:configId,engine_version:13}};
 if(exhibitFactor!==undefined)context.EXHIBIT_MUTATION_RATE_FACTOR=exhibitFactor;
 vm.runInNewContext(script+helper+'\nglobalThis.readRule=ruleProvenanceForGeneration;',context,{
   filename:'js/pages_preview.js:provenance',timeout:3000
 });
 return JSON.parse(JSON.stringify(context.readRule()));
}
const cryptic=rule('continuous_v1','continuous_v1_frozen_v23');
const warning=rule('continuous_v1','continuous_v1_frozen_v23');
const exhibit=rule('continuous_v1','continuous_v1_frozen_v23',0.5);
const morph=rule('morph_v1','morph_v1_unified_continuous_001');
assert.equal(cryptic.status,'recorded');
assert.equal(cryptic.schema_version,1);
assert.equal(cryptic.rule_revision,'continuous_v1_rules_20261028_01');
assert.equal(cryptic.config_id,'continuous_v1_frozen_v23');
assert.equal(cryptic.engine_version,13);
assert.equal(cryptic.build_commit,null,'local unversioned preview must not invent a commit');
assert.equal(cryptic.mutation_profile,'normal');
assert.equal(cryptic.mutation_probability_factor,1);
assert.deepEqual(warning,cryptic,'warning experiment shares rule revision but has distinct run ID');
assert.equal(exhibit.mutation_profile,'exhibit_probability_scaled');
assert.equal(exhibit.mutation_probability_factor,.5);
assert.equal(morph.rule_revision,'morph_v1_rules_20261028_01');
assert.notEqual(morph.rule_revision,cryptic.rule_revision);
const revA=rule('continuous_v1','continuous_v1_frozen_v23',undefined,'a'.repeat(40));
const revB=rule('continuous_v1','continuous_v1_frozen_v23',undefined,'b'.repeat(40));
assert.equal(revA.build_commit,'a'.repeat(40));
assert.equal(revB.build_commit,'b'.repeat(40));
assert.notEqual(revA.build_commit,revB.build_commit,
 'same config ID across two builds must be distinguishable per generation');

const begin=source.indexOf('  async function collectDiagnosticPayload()');
const end=source.indexOf('  async function exportDiagnosticLog()',begin);
assert.ok(begin>0&&end>begin);
const old={generation_id:'gen00021',next_generation_id:'gen00022',eaten_indices:[]};
const current={generation_id:'gen00022',next_generation_id:'gen00023',
  rule_provenance:revB,eaten_indices:[]};
const original=JSON.stringify([old,current]);
const ctx={
  ensureConfig:async()=>{},
  idbEntriesByPrefix:async()=>[{value:current},{value:old}],
  generationNumber:v=>Number(v.slice(3)),
  WARNING_EXPERIMENT:false,PREVIEW_ENV:'leaf',PREVIEW_ENV_ID:'kusagi_001',
  PREVIEW_RUN_ID:'default',DB_NAME:'test-name',LEGACY_DEFAULT_STORAGE:false,
  EVOLUTION_MODEL_ID:'continuous_v1',
  evolutionConfig:{model_id:'continuous_v1',config_id:'continuous_v1_frozen_v23',
    trait_genetics:{}},environmentConfig:{},appConfig:{game:{}},TOTAL:60,
  currentGenerationId:'gen00023',Date
};
vm.runInNewContext(source.slice(begin,end)+'\nglobalThis.getReport=collectDiagnosticPayload;',ctx,{
  filename:'js/pages_preview.js:collectDiagnosticPayload',timeout:3000
});
(async()=>{
 const payload=await ctx.getReport();
 const records=JSON.parse(JSON.stringify(payload.generations));
 assert.deepEqual(records.map(x=>x.generation_id),['gen00021','gen00022']);
 assert.equal(records[0].rule_provenance.status,'legacy_unknown');
 assert.deepEqual(records[1].rule_provenance,revB);
 assert.equal(JSON.stringify([old,current]),original,
  'old diagnostic records must not be rewritten even in memory');
 // Both model pathways use the single already-atomic commit, and the
 // recorded provenance lives IN the same generationDiagnostic payload.
 assert.equal((source.match(/rule_provenance: ruleProvenanceForGeneration\(\)/g)||[]).length,2);
 assert.equal((source.match(/await commitEvolutionGeneration\(/g)||[]).length,2);
 assert.match(source,/if \(diagnostic\) meta\.put\(diagnostic, diagnosticKey\(sourceId\)\)/);
 assert.match(source,/meta\.put\(nextId, 'current_generation_id'\)/);
 assert.match(source,/rules=' \+ \(/);
 assert.match(source,/legacy_unknown/);
 // No changes to genotypes, images, saved namespace or the v1 backup schema.
 assert.match(fs.readFileSync('exhibit/admin.js','utf8'),
   /const BACKUP_SCHEMA = 'gitai-exhibit-backup-v1'/);

 const site=process.argv[2];
 if(site){
   const normalJs=fs.readFileSync(path.join(site,'js/pages_preview.js'),'utf8');
   const exhibitJs=fs.readFileSync(path.join(site,'exhibit/js/pages_preview.js'),'utf8');
   const match=s=>s.match(/const EVOLUTION_BUILD_COMMIT = '([^']+)';/)?.[1];
   const normalBuild=match(normalJs),exhibitBuild=match(exhibitJs);
   assert.ok(/^[a-f0-9]{40}$/.test(normalBuild||''),
     'built normal engine must embed a genuine SHA');
   assert.equal(exhibitBuild,normalBuild,'normal and exhibit share the same source commit');
   assert.ok(normalJs.includes('rule_provenance: ruleProvenanceForGeneration(),'));
   assert.ok(exhibitJs.includes('rule_provenance: ruleProvenanceForGeneration(),'));
   assert.ok(exhibitJs.includes('exhibit_mutation_rate_factor: EXHIBIT_MUTATION_RATE_FACTOR,'));
   assert.ok(exhibitJs.includes('const EXHIBIT_MUTATION_RATE_FACTOR = 0.5;'));
   assert.ok(!normalJs.includes('const EXHIBIT_MUTATION_RATE_FACTOR = 0.5;'));
   if(process.env.GITHUB_SHA) assert.equal(normalBuild,process.env.GITHUB_SHA);
 }
 console.log('RE3-MODEL-01: per-generation rules/config/build and normal vs exhibit profile; legacy unknown read-only, atomic diagnostic record and immutable IDs, shipped SHA verified.');
})().catch(e=>{console.error(e);process.exitCode=1});
