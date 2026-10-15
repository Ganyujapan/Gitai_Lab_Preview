const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../js/trophy_rules.js');

function record(id, trophy_rank, rank_calibration_version='gitai_rank_calibrated_v1', evolution_model_id='continuous_v1') {
  return {id,trophy_rank,rank_calibration_version,evolution_model_id};
}
test('no rank grants before calibrated verification', () => {
  assert.equal(rules.eligible(record('1','S','v1_90_points')),false);
  assert.equal(rules.eligible(record('1','A')),false);
  assert.equal(rules.eligible(record('1','SS','gitai_rank_calibrated_v1','morph_v1')),false);
  assert.equal(rules.eligible({id:'1',v1_score:100,evolution_model_id:'continuous_v1'}),false);
});
test('S and SS distinct specimens earn unlocks at 1 and 10', () => {
  let s=rules.merge(null,[]);
  assert.deepEqual(rules.progress(s).environments.map(x=>x.unlocked),[true,false,false]);
  s=rules.merge(s,[record('1','S'),record('1','S')]);
  assert.equal(rules.progress(s).count,1);
  assert.deepEqual(rules.progress(s).environments.map(x=>x.unlocked),[true,true,false]);
  s=rules.merge(s,Array.from({length:9},(_,i)=>record('SS'+i,'SS')));
  assert.equal(rules.progress(s).count,10);
  assert.deepEqual(rules.progress(s).environments.map(x=>x.unlocked),[true,true,true]);
  assert.equal(rules.progress(s).environments[2].playable,false);
});
test('unlock persists when original specimens were deleted or repeated', () => {
  const originals=rules.merge(null,Array.from({length:10},(_,i)=>record('moth'+i,'S')));
  const persisted=rules.merge(JSON.parse(JSON.stringify(originals)),[]);
  assert.equal(rules.progress(persisted).count,10);
  assert.equal(rules.progress(rules.merge(persisted,[record('moth0','S')])).count,10);
});
