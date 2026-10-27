'use strict';
// MODEL-02: independent warning-color mutation lotteries, both in the live
// population and the seeded neutral 20-generation headstart.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const warning=require('../../js/warning_color.js');
const source=fs.readFileSync('js/pages_preview.js','utf8');
const build=fs.readFileSync('exhibit/build.py','utf8');
assert.equal(typeof warning.independentSpecialMutationIndices,'function');
assert.equal(warning.synchronizedSpecialMutationIndices,undefined,
 'old synchronized lottery must not be called');
function scripted(sequence){
 let used=0;
 return {rng(){
   assert.ok(used<sequence.length,'too many random draws');
   return sequence[used++];
 },count:()=>used};
}
for(const item of [
 {numbers:[0.9,0.8],expected:[],count:2},
 {numbers:[0.05,0.40,0.8],expected:[13],count:3},
 {numbers:[0.8,0.05,0.5],expected:[46],count:3},
 {numbers:[0.05,0.01,0.05,0.99],expected:[1,60],count:4},
]){
 const seq=scripted(item.numbers);
 assert.deepEqual(warning.independentSpecialMutationIndices(.2,seq.rng),item.expected);
 assert.equal(seq.count(),item.count);
}
assert.deepEqual(warning.independentSpecialMutationIndices(0,()=>0),[]);
assert.deepEqual(warning.independentSpecialMutationIndices(1,()=>0),[1,31]);
assert.deepEqual(warning.independentSpecialMutationIndices(-1,()=>0),[]);
assert.deepEqual(warning.independentSpecialMutationIndices(9,()=>.99999),[30,60]);
for(const r of [[0,0],[1,0],[0,1],[1,1]]) {
 const s=scripted([r[0]?0.05:0.8,0.5,r[1]?0.05:0.8,0.6].slice(
  0,r[0]&&r[1]?4:r[0]||r[1]?3:2));
 if(r[0]&&r[1])assert.equal(warning.independentSpecialMutationIndices(.2,s.rng).length,2);
}
// Stable pseudo-random stream allows a reproducible approximation of the
// independent joint probabilities, rather than merely testing example rolls.
let state=0xabcddcba;
const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296};
const n=50000,observed={none:0,poison:0,harmless:0,both:0};
for(let i=0;i<n;i++){
 const chosen=warning.independentSpecialMutationIndices(.2,random);
 assert.ok(chosen.length<=2);
 const hasP=chosen.some(index=>index>=1&&index<=30);
 const hasH=chosen.some(index=>index>=31&&index<=60);
 assert.equal(chosen.length,Number(hasP)+Number(hasH),
  'at most one chosen offspring per lineage');
 observed[hasP&&hasH?'both':hasP?'poison':hasH?'harmless':'none']++;
}
for(const [name,p] of Object.entries({none:.64,poison:.16,harmless:.16,both:.04})){
 const fraction=observed[name]/n;
 assert.ok(Math.abs(fraction-p)<.012,
   'independent p=.2 distribution '+name+' expected '+p+' got '+fraction);
}
assert.ok(source.includes('WARNING.independentSpecialMutationIndices(specialP, rng)'),
 'neutral headstart must use independent lineage lotteries and preserve seeded RNG');
assert.ok(source.includes('WARNING.independentSpecialMutationIndices(\n        specialMutationGenerationP,'),
 'live mutation event must use independent warning lineage lotteries');
assert.ok(!source.includes('synchronizedSpecialMutationIndices('));
assert.ok(!source.includes('const mutatedChildIndex = rng() < specialP'),
 'old neutral single-60 lottery must be absent');
assert.ok(source.includes('if (specialMutationChildIndices.has(item.childIndex))'),
 'headstart mutation must use selected child set');
assert.ok(source.includes('const specialMutationChildSet = new Set(specialMutationChildIndices)'),
 'live mutation must use selected child set');
assert.ok(source.includes('Math.random() < specialMutationGenerationP'),
 'cryptic single-child mutation lottery must stay unchanged');
assert.match(build,/const EXHIBIT_MUTATION_RATE_FACTOR = 0\.5/);
assert.ok(build.includes("// Applies to live gameplay, not the warning experiment's neutral headstart."),
 'exhibition neutral headstart reduction policy must not change');
console.log('MODEL-02: independent poison/harmless mutation events (none/one/both), p=.2 joint distribution, cryptic behavior and exhibit factor verified.');
