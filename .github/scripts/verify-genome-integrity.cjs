'use strict';
// EV-02: original function from pages_preview.js executed in a test VM.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/pages_preview.js','utf8');
const start = source.indexOf('  function validateLoadedGenome(');
const end = source.indexOf('\n  function inheritModule(', start);
assert.ok(start >= 0 && end > start,'DNA load function not found');
const fn = source.slice(start,end);
assert.ok(source.includes('function inferGenomeFromImage('),
  'Keep legacy image inference code available ONLY for future explicit migration');
assert.doesNotMatch(fn,/inferGenomeFromImage\s*\(/,
  'Active evolution must not infer genotype from phenotype');
assert.doesNotMatch(fn,/idbPut\s*\(/,'Genotype lookup must never mutate existing records');
const loci = JSON.parse(fs.readFileSync(
  'data/evolution_models/continuous_v1/config.json','utf8'
)).trait_genetics.pattern_loci;
function scenario(stored) {
  const db = new Map();
  const key = 'gen00234:genome:31';
  if (stored !== undefined) db.set(key,stored);
  const writes=[];
  const cx = {
    META_STORE:'meta',WARNING_EXPERIMENT:false,
    evolutionConfig:{trait_genetics:{pattern_loci:loci}},
    genomeKey:(generation,index)=>generation+':genome:'+index,
    idbGet:async(store,k)=>db.get(k),
    idbPut:async(...args)=>{writes.push(args); db.set(args[1],args[2])},
    inferGenomeFromImage:()=>{throw Error('Image inference MUST NOT be invoked')}
  };
  vm.runInNewContext(fn+'\nglobalThis.run=loadGenomeOrInfer',cx,
    {filename:'js/pages_preview.js:loadGenomeOrInfer',timeout:1000});
  return {run:()=>cx.run('gen00234',31,{data:[255,255,255]}),db,writes,key};
}
(async()=>{
  const original={
    schema_version:1,baseHue:0,baseSaturation:0.5,baseValue:0.6,
    patternContrast:0.55,textureStrength:0.02,textureSeed:1234,
    modules:Object.fromEntries(loci.map(locus=>[locus.id,{
      alleles:[1,1],cx:0.5,cy:0.5,rx:0.2,ry:0.15,
      valueEffect:-0.25,hueEffect:0,saturationEffect:0,phase:0,
      angle:0,frequency:1.5,roughness:0.2
    }]))
  };
  const valid=scenario(original);
  const value=await valid.run();
  assert.equal(value,original,'Normal schema-v1 DNA must be returned unchanged');
  assert.deepEqual(original.modules.central_blotch.alleles,[1,1]);
  assert.deepEqual(valid.writes,[]);

  const stringV1=scenario({...original,schema_version:'1'});
  assert.equal((await stringV1.run()).schema_version,'1',
    'Preserve current v1 coercion behavior');

  for(const faulty of [undefined,null,false,'invalid',{},{
    schema_version:2,modules:{stripe:{alleles:[1,1]}}
  }]) {
    const c=scenario(faulty);
    await assert.rejects(c.run(),/遺伝情報が(?:欠損|未対応の形式)/);
    assert.deepEqual(c.writes,[], 'No approximate DNA may be saved');
    if (faulty === undefined) assert.equal(c.db.has(c.key),false);
    else assert.equal(c.db.get(c.key),faulty,'Existing unsupported DNA preserved');
  }
  const invalidCases=[
    {...original,baseValue:NaN},
    {...original,baseValue:Infinity},
    {...original,baseValue:'0.6'},
    {...original,baseValue:undefined},
    {...original,baseSaturation:40},
    {...original,modules:{...original.modules,
      central_blotch:{...original.modules.central_blotch,valueEffect:'invalid'}}},
    {...original,modules:{...original.modules,
      central_blotch:{...original.modules.central_blotch,valueEffect:NaN}}},
    {...original,modules:{...original.modules,
      central_blotch:{...original.modules.central_blotch,alleles:[1,2]}}},
    {...original,modules:{...original.modules,central_blotch:undefined}},
    {...original,modules:{}}
  ];
  for(const invalid of invalidCases){
    const c=scenario(invalid);
    await assert.rejects(c.run(),/遺伝情報が不正/);
    assert.equal(c.db.get(c.key),invalid,'Reject without modifying stored DNA');
    assert.deepEqual(c.writes,[],'Never create replacement offspring or DNA');
  }
  const older=schema=>({
    ...schema,modules:{...schema.modules,
      central_blotch:{alleles:[1,0],valueEffect:-0.2}}
  });
  // Older v1 modules can lack newer optional pigment or geometry parameters.
  const compatible=older(original);
  assert.equal(await scenario(compatible).run(),compatible);
  console.log('RE2-EV-02: valid old/current schema1 unchanged, NaN/Infinity/string/missing loci/alleles rejected without writes.');
})().catch(error=>{console.error(error);process.exitCode=1});
