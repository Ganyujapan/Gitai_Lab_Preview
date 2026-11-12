'use strict';
// Results-first UI transplant: no change to evolution, data storage or exhibit PWA.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('css/portal_exhibit_results.css','utf8');
const exhibitBuild=fs.readFileSync('exhibit/build.py','utf8');
const experimentSaves=fs.readFileSync('js/experiment_saves.js','utf8');
const modes=fs.readFileSync('exhibit/game.css','utf8');

assert.match(html,/href="css\/portal_exhibit_results\.css\?v=20261112-results-first1"/);
for(const name of [
 'reviewOverlay','reviewGeneration','reviewTitle','reviewMessage','evolutionStatus',
 'compareButton','continueButton','specimenBoxButton','theaterButton',
 'resultBackToMenu','evolutionOverlay','evolutionNextButton',
 'evolutionSaveExperimentButton','evolutionResetExperimentButton',
 'evolutionSaveAndResetExperimentButton'
]){
 assert.ok(html.includes('id="'+name+'"'),'existing action or data must remain: '+name);
}
assert.match(html,/compareButton\.addEventListener\('click', \(event\) => \{[\s\S]{0,140}showEvolutionComparison\(\);/);
assert.match(html,/continueButton\.addEventListener\('click', \(\) => \{/);
assert.match(html,/playEndOfGenerationShutter\(async \(\) => \{/);
assert.match(html,/showResults\(\); \/\/ Keep existing next-generation\/submit state intact\./);
assert.match(html,/if \(state\.pendingMutationEvent\) \{\s*showMutationReveal\(\);/);
assert.match(html,/if \(isEntertainmentModel\(\)\) \{\s*state\.submitStatus = 'ready'/);
assert.match(experimentSaves,/className = 'gitai-experiment-result-actions'/);
assert.ok(experimentSaves.includes('gitaiOpenRecords'), 'experiment records must remain');
assert.ok(experimentSaves.includes('gitaiResultStartNew'), 'new experiment must remain');
assert.match(exhibitBuild,/for normal_only in \("css\/portal_exhibit_modes\.css", "css\/portal_exhibit_results\.css"/);
assert.match(exhibitBuild,/regular_results_css/);
assert.match(modes,/#reviewOverlay \.review-actions #continueButton/);
for(const selector of [
 '#reviewOverlay .panel',
 '#reviewOverlay .review-actions',
 '#reviewOverlay .review-actions #continueButton',
 '#reviewOverlay .review-actions #compareButton',
 '#reviewOverlay #specimenBoxButton',
 '#reviewOverlay #theaterButton',
 '#reviewOverlay .gitai-experiment-result-actions'
]){
 assert.ok(css.includes(selector),'new result style: '+selector);
}
const reviewCss=css.slice(css.indexOf('#reviewOverlay .review-actions #continueButton'));
assert.match(reviewCss,/background:\s*#346a37/,'visible primary green action');
assert.match(css,/overflow-y:\s*auto/,'small screens need scrolling');
assert.match(css,/@media \(max-height: 650px\)/);

const start=html.indexOf('  function showRankMilestoneOrGallery() {');
const end=html.indexOf('  function revealEvolutionTheaterAtBottom()',start);
assert.ok(start>=0 && end>start, 'must locate exact result-first flow');
const behavior=html.slice(start,end);
const overlayClasses=new Set();
let galleryCalls=0,acknowledged=0,recordCalls=0;
const ctx={
 state:{pendingRankMilestone:null},
 showEvolutionComparison(){galleryCalls++},
 rankMilestoneGrade:{textContent:'',dataset:{}},
 rankMilestoneImage:{src:''},
 rankMilestoneDescription:{textContent:''},
 rankMilestoneSaveButton:{disabled:false,textContent:''},
 rankMilestoneContinueButton:{textContent:''},
 rankMilestoneOverlay:{
  classList:{
    add(k){overlayClasses.add(k)},
    remove(k){overlayClasses.delete(k)},
    contains(k){return overlayClasses.has(k)}
  }
 },
 specimenGet(){recordCalls++;return Promise.resolve(null)},
 specimenIdentity(){return 'unused'},
 acknowledgeRankMilestone(){acknowledged++}
};
vm.createContext(ctx);
vm.runInContext(behavior+'\nglobalThis.openResult=showRankMilestoneOrGallery;globalThis.closeRank=closeRankMilestone;',ctx);
ctx.openResult();
assert.equal(galleryCalls,0,'completed generation must show results, NOT auto-gallery');
assert.equal(overlayClasses.size,0,'without a milestone no overlay opens');
ctx.state.pendingRankMilestone={rank:'S',src:'moth.png',index:2,score:91.7,generationId:'gen00014'};
ctx.openResult();
assert.equal(overlayClasses.has('visible'),true,'new rank milestone still displays');
assert.equal(ctx.rankMilestoneGrade.textContent,'S');
assert.equal(recordCalls,1,'specimen status checks still run');
ctx.closeRank();
assert.equal(overlayClasses.has('visible'),false);
assert.equal(acknowledged,1,'rank must be acknowledged');
assert.equal(galleryCalls,0,'closing rank milestone must show existing result, not the gallery');
assert.equal(ctx.rankMilestoneContinueButton.textContent,'次へ');
if(fs.existsSync('_site/exhibit/game.html')){
 const compiled=fs.readFileSync('_site/exhibit/game.html','utf8');
 const precache=fs.readFileSync('_site/exhibit/precache.json','utf8');
 assert.ok(!compiled.includes('portal_exhibit_results.css'));
 assert.ok(!precache.includes('portal_exhibit_results.css'));
 assert.ok(!fs.existsSync('_site/exhibit/css/portal_exhibit_results.css'));
}
console.log('Results-first normal UI: rank/mutation preserved, review before optional gallery, all normal buttons & saves intact, frozen exhibit excluded.');
