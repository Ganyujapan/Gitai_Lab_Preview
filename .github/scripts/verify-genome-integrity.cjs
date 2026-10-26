'use strict';
// EV-02: original function from pages_preview.js executed in a test VM.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/pages_preview.js','utf8');
const start = source.indexOf('  async function loadGenomeOrInfer(');
const end = source.indexOf('\n  function inheritModule(', start);
assert.ok(start >= 0 && end > start,'DNA load function not found');
const fn = source.slice(start,end);
assert.ok(source.includes('function inferGenomeFromImage('),
  'Keep legacy image inference code available ONLY for future explicit migration');
assert.doesNotMatch(fn,/inferGenomeFromImage\s*\(/,
  'Active evolution must not infer genotype from phenotype');
assert.doesNotMatch(fn,/idbPut\s*\(/,'Genotype lookup must never mutate existing records');
function scenario(stored) {
  const db = new Map();
  const key = 'gen00234:genome:31';
  if (stored !== undefined) db.set(key,stored);
  const writes=[];
  const cx = {
    META_STORE:'meta',
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
  const original={schema_version:1,modules:{stripe:{
    alleles:[1,1],strength:0.7
  }},lineage:'poison',h:0,s:0.5,v:0.6};
  const valid=scenario(original);
  const value=await valid.run();
  assert.equal(value,original,'Normal schema-v1 DNA must be returned unchanged');
  assert.deepEqual(original.modules.stripe.alleles,[1,1]);
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
  console.log('EV-02: Existing schema-v1 genome unchanged; absent/future/invalid DNA stops evolution without mutation or fake pattern alleles.');
})().catch(error=>{console.error(error);process.exitCode=1});
