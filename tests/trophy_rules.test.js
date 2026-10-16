const test=require('node:test');
const assert=require('node:assert/strict');
const rules=require('../js/trophy_rules.js');
const access=require('../js/habitat_access.js');
const r=(id,trophy_rank,rank_calibration_version='gitai_rank_calibrated_v1',evolution_model_id='continuous_v1')=>({id,trophy_rank,rank_calibration_version,evolution_model_id});
test('test mode exposes kusagi, old bark and old sand without awards',()=>{
  const a=rules.progress(null,{testMode:true});
  assert.equal(access.defaultEnvironment,'kusagi_001');
  assert.deepEqual(a.environments.map(e=>e.id),['kusagi_001','bark_001','sand_001']);
  assert.ok(a.environments.every(e=>e.unlocked&&e.playable));
});
test('production hides legacy environments and requires S/SS awards',()=>{
  let state=rules.merge(null,[]);
  let p=rules.progress(state,{testMode:false});
  assert.deepEqual(p.environments.map(e=>e.id),['kusagi_001','future_001','future_002']);
  assert.deepEqual(p.environments.map(e=>e.unlocked),[true,false,false]);
  state=rules.merge(state,[r('a','S'),r('a','S')]);
  p=rules.progress(state,{testMode:false});
  assert.equal(p.count,1);
  assert.deepEqual(p.environments.map(e=>e.unlocked),[true,true,false]);
  state=rules.merge(state,Array.from({length:9},(_,i)=>r('b'+i,'SS')));
  p=rules.progress(state,{testMode:false});
  assert.equal(p.count,10);
  assert.deepEqual(p.environments.map(e=>e.unlocked),[true,true,true]);
  assert.equal(p.environments[1].playable,false);
  assert.equal(rules.progress(rules.merge(state,[]),{testMode:false}).count,10);
});
test('unverified, non-S, and education specimens never grant awards',()=>{
  assert.equal(rules.eligible(r('x','S','guess')),false);
  assert.equal(rules.eligible(r('x','A')),false);
  assert.equal(rules.eligible(r('x','SS','gitai_rank_calibrated_v1','morph_v1')),false);
  assert.equal(rules.eligible({id:'x',v1_score:100,evolution_model_id:'continuous_v1'}),false);
});
