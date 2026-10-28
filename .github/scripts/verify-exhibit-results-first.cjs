'use strict';
// Regression: on the real iPad the exhibition auto-opened the moth gallery
// immediately after the result. The result was present but covered, hiding
// the "次の人へ変わる" button. Execute functions FROM the built game.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const original=fs.readFileSync('index.html','utf8');
const normal=fs.readFileSync('_site/index.html','utf8');
const generated=fs.readFileSync('_site/exhibit/game.html','utf8');
const controller=fs.readFileSync('exhibit/game.js','utf8');
const build=fs.readFileSync('exhibit/build.py','utf8');

function sliceFunction(text,fn,next) {
  const begin=text.indexOf('  function '+fn+'() {');
  const end=text.indexOf('  function '+next+'() {',begin+1);
  assert.ok(begin>=0 && end>begin,fn+' must be present');
  return text.slice(begin,end);
}
const normalRank=sliceFunction(normal,'showRankMilestoneOrGallery','closeRankMilestone');
const exhibitRank=sliceFunction(generated,'showRankMilestoneOrGallery','closeRankMilestone');
const exhibitClose=sliceFunction(generated,'closeRankMilestone','revealEvolutionTheaterAtBottom');
assert.match(normalRank,/showEvolutionComparison\(\)/,
  'normal entertainment version must retain automatic gallery');
assert.doesNotMatch(exhibitRank,/showEvolutionComparison\(\)/,
  'exhibit must not cover the handover panel with the gallery');
assert.doesNotMatch(exhibitClose,/showEvolutionComparison\(\)/,
  'rare-rank acknowledgement must also leave result visible');
assert.match(exhibitRank,/rankMilestoneOverlay\.classList\.add\('visible'\)/,
  'rare-rank announcement must still be presented');
assert.match(generated,/showResults\(\); \/\/ Keep existing next-generation\/submit state intact\./);
assert.match(generated,/if \(state\.pendingMutationEvent\) \{\s*showMutationReveal\(\)/);
assert.match(generated,/compareButton\.addEventListener\('click',[\s\S]*?showEvolutionComparison\(\)/,
  'gallery remains accessible by intentional review button');
assert.match(generated,/src="game\.js"/);
assert.match(controller,/button\.textContent = '次の人へ変わる'/);
assert.match(controller,/reviewOverlay\?\.querySelector\('\.review-actions'\)\?\.insertAdjacentElement\('afterend', button\)/);
assert.match(controller,/if \(!committedGeneration\) throw Error\(/,
  'handover must still confirm the saved offspring before navigation');
assert.match(build,/page\.replace\(auto_gallery, review_first, 1\)/);
assert.match(build,/page\.replace\(rank_auto_gallery, rank_to_review, 1\)/);
assert.match(original,/function showRankMilestoneOrGallery\(\) \{[\s\S]*?showEvolutionComparison\(\)/,
  'source site must remain untouched');

const called={gallery:0,rank:0,acknowledge:0,removed:0};
const c={
  state:{pendingRankMilestone:null},
  showEvolutionComparison:()=>{called.gallery++},
  rankMilestoneGrade:{textContent:'',dataset:{}},
  rankMilestoneImage:{src:''},
  rankMilestoneDescription:{textContent:''},
  rankMilestoneSaveButton:{disabled:false,textContent:''},
  rankMilestoneContinueButton:{textContent:''},
  rankMilestoneOverlay:{classList:{
    add:(name)=>{assert.equal(name,'visible');called.rank++},
    contains:(name)=>name==='visible',
    remove:(name)=>{assert.equal(name,'visible');called.removed++}
  }},
  specimenGet:async()=>null,
  specimenIdentity:()=>({}),
  acknowledgeRankMilestone:()=>{called.acknowledge++},
  Number,String
};
vm.runInNewContext(exhibitRank+'\n'+exhibitClose+
  '\nglobalThis.testRank=showRankMilestoneOrGallery;'+
  '\nglobalThis.testClose=closeRankMilestone;',c,
  {filename:'_site/exhibit/game.html:result',timeout:2000});
c.testRank();
assert.equal(called.gallery,0,'no auto gallery after an ordinary round');
assert.equal(called.rank,0);
c.state.pendingRankMilestone={rank:'S',generationId:'gen00012',
  index:1,src:'test.png',score:90,level:4};
c.testRank();
assert.equal(called.rank,1,'rare-rank notice remains');
assert.equal(called.gallery,0);
c.testClose();
assert.equal(called.removed,1);
assert.equal(called.acknowledge,1);
assert.equal(called.gallery,0,'rare-rank close returns to result, not gallery');
console.log('Exhibit-only final round shows result/visitor handover first, preserves mutation/rank and click-to-view gallery; public preview unchanged.');
