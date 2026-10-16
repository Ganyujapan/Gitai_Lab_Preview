const test=require('node:test');
const assert=require('node:assert/strict');
const access=require('../js/habitat_access.js');
const rules=require('../js/trophy_rules.js');
const specimen=(id,rank,version='gitai_rank_calibrated_v1',model='continuous_v1')=>({
  id,trophy_rank:rank,rank_calibration_version:version,evolution_model_id:model,
});
test('13 photo environments, unambiguous paths, ja/en names, plus 2 comparison scenes',()=>{
  assert.equal(access.userHabitats.length,13);
  assert.equal(access.legacyComparisons.length,2);
  assert.equal(access.allHabitats.length,15);
  assert.equal(new Set(access.allHabitats.map(e=>e.id)).size,15);
  assert.equal(new Set(access.userHabitats.map(e=>e.asset)).size,13);
  assert.equal(access.defaultEnvironment,'kusagi_001');
  assert.equal(access.get('kusagi_001').asset,'img/backgrounds/bg_leaf01.png');
  assert.equal(access.get('wood_002').ja,'木の板2');
  assert.equal(access.get('bush_001').en,'Bush 1');
  assert.ok(access.userHabitats.every(e=>e.ja.length&&e.en.length&&/^img\/backgrounds\/bg_/.test(e.asset)));
});
test('test picker unlocks all 15 environments but release only first, with 2 reward placeholders',()=>{
  assert.equal(access.testMode,true);
  const testProgress=rules.progress(null,{testMode:true});
  assert.equal(testProgress.environments.length,15);
  assert.ok(testProgress.environments.every(e=>e.unlocked && e.playable));
  const production=rules.progress(null,{testMode:false});
  assert.deepEqual(production.environments.map(e=>e.id),['kusagi_001','future_001','future_002']);
  assert.deepEqual(production.environments.map(e=>e.unlocked),[true,false,false]);
  assert.deepEqual(production.environments.map(e=>e.playable),[true,false,false]);
});
test('1 S/SS and 10 distinct S/SS trophies cannot be forged by an arbitrary numeric v1 score',()=>{
  assert.equal(rules.eligible({id:'x',v1_score:100,evolution_model_id:'continuous_v1'}),false);
  assert.equal(rules.eligible(specimen('x','S','guessed')),false);
  assert.equal(rules.eligible(specimen('x','A')),false);
  assert.equal(rules.eligible(specimen('x','SS','gitai_rank_calibrated_v1','morph_v1')),false);
  let s=rules.merge(null,[specimen('a','S'),specimen('a','S')]);
  assert.equal(rules.progress(s,{testMode:false}).count,1);
  assert.deepEqual(rules.progress(s,{testMode:false}).environments.map(e=>e.unlocked),[true,true,false]);
  s=rules.merge(s,Array.from({length:9},(_,i)=>specimen('b'+i,'SS')));
  assert.deepEqual(rules.progress(s,{testMode:false}).environments.map(e=>e.unlocked),[true,true,true]);
  assert.equal(rules.progress(rules.merge(s,[]),{testMode:false}).count,10);
});
