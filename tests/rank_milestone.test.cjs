'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function sliceBetween(start,end){
 const x=html.indexOf(start),y=html.indexOf(end,x+start.length);
 assert.ok(x>=0&&y>x,'missing '+start);return html.slice(x,y);
}
function makeRankHarness(){
 const data=new Map(),context={environmentId:'leaf1',evolutionModelId:'continuous_v1'};
 const state={pendingRankMilestone:null};
 const localStorage={
  getItem:k=>data.has(k)?data.get(k):null,
  setItem:(k,v)=>data.set(k,v)
 };
 const source=sliceBetween('  const RANK_ORDER = Object.freeze(', '  function revealEvolutionTheaterAtBottom() {');
 const factory=new Function('window','state','localStorage','isEntertainmentModel',
   source+';return {rankMilestoneStorageKey,highestPreviouslyReachedRank,selectNewRankMilestone,acknowledgeRankMilestone};');
 return {state,data,context,...factory({GitaiPagesPreview:{context}},state,localStorage,()=>true)};
}
test('announce the highest newly reached rank, once per habitat',()=>{
 const h=makeRankHarness();
 const D={rank:'D',score:33,index:1},C={rank:'C',score:47,index:2},B={rank:'B',score:58,index:8};
 const winners=new Map([['D',D],['C',C],['B',B]]);
 assert.equal(h.highestPreviouslyReachedRank(),0);
 assert.deepEqual(h.selectNewRankMilestone(winners),{...B,level:2});
 h.state.pendingRankMilestone=h.selectNewRankMilestone(winners);
 h.acknowledgeRankMilestone();
 assert.equal(h.state.pendingRankMilestone,null);
 assert.equal(h.highestPreviouslyReachedRank(),2);
 assert.equal(h.selectNewRankMilestone(winners),null);
 assert.equal(h.selectNewRankMilestone(new Map([['A',{rank:'A',score:74,index:4}]] )).rank,'A');
});
test('rank records persist across runs but not across habitats',()=>{
 const h=makeRankHarness(),key=h.rankMilestoneStorageKey();
 assert.match(key,/leaf1:continuous_v1$/);
 h.data.set(key,'4');
 assert.equal(h.highestPreviouslyReachedRank(),4);
 assert.equal(h.selectNewRankMilestone(new Map([['S',{rank:'S',score:82,index:9}]])),null);
 h.context.environmentId='bark';
 assert.equal(h.highestPreviouslyReachedRank(),0);
 assert.equal(h.selectNewRankMilestone(new Map([['C',{rank:'C',score:49,index:7}]] )).rank,'C');
 h.context.environmentId='leaf1';
 assert.equal(h.highestPreviouslyReachedRank(),4);
});
test('mutation screen shows a single moth and advances only via the Next button',()=>{
 assert.match(html,/grid-template-columns:\s*minmax\(0, 1fr\)/);
 assert.match(html,/function renderMutationRevealItem\(\)/);
 assert.match(html,/mutationRevealGrid\.replaceChildren\(\)/);
 assert.match(html,/state\.mutationRevealIndex \+= 1;\s*renderMutationRevealItem\(\)/);
 assert.doesNotMatch(html,/mutationRevealOverlay\.addEventListener\('click'/);
 assert.doesNotMatch(html,/mutation-tap-hint|画面をタップして次の蛾へ/);
 assert.match(html,/id="mutationRevealContinueButton" type="button">次へ<\/button>/);
 assert.match(html,/mutationRevealContinueButton\.textContent = '次へ';/);
 assert.doesNotMatch(html,/mutationRevealContinueButton\.textContent = last/);
 assert.match(html,/mutationRevealContinueButton\.addEventListener\('click', \(event\) => \{\s*event\.stopPropagation\(\);\s*advanceMutationReveal\(\)/);
 assert.match(html,/save\.addEventListener\('click', async \(event\) => \{\s*event\.stopPropagation\(\)/);
 assert.match(html,/await saveSpecimen\(state\.currentGenerationId, index, src\)/);
});
test('rank celebration uses the top scoring moth of the new grade and offers specimen saving',()=>{
 assert.match(html,/id="rankMilestoneOverlay"/);
 assert.match(html,/id="rankMilestoneGrade"/);
 assert.match(html,/id="rankMilestoneImage"/);
 assert.match(html,/rankMilestoneSaveButton\.addEventListener\('click'/);
 assert.match(html,/await saveSpecimen\(milestone\.generationId, milestone\.index, milestone\.src\)/);
 assert.match(html,/if \(!current \|\| score > current\.score\) winners\.set\(rank,/);
 assert.match(html,/analyzeGitaiPlacement\(\s*buildMothAnalysis\(image\), bgData, m\.x, m\.y, m\.size\s*\)\.total/);
 assert.match(html,/rankMilestoneGrade\.dataset\.rank = event\.rank/);
});
test('sequence is shutter, mutation, rank, gallery; D is the baseline',()=>{
 assert.match(html,/playEndOfGenerationShutter\(async \(\) => \{[\s\S]*?showResults\(\);[\s\S]*?await calculatePlayedGenerationRanks\(\);[\s\S]*?if \(state\.pendingMutationEvent\)/);
 assert.match(html,/advanceMutationReveal\(\)[\s\S]*?clearPendingMutationEvent\(\);\s*showRankMilestoneOrGallery\(\)/);
 assert.match(html,/function closeRankMilestone\(\)[\s\S]*?acknowledgeRankMilestone\(\);\s*showEvolutionComparison\(\)/);
 assert.match(html,/const RANK_ORDER = Object\.freeze\(\['D', 'C', 'B', 'A', 'S', 'SS'\]\)/);
 assert.match(html,/return Number\.isInteger\(raw\) && raw >= 0 && raw < RANK_ORDER\.length \? raw : 0/);
});

test('rank announcement letter inherits its headline font but gallery badges stay pixel styled',()=>{
 const announcement=html.match(/#rankMilestoneGrade\s*\{([^}]+)\}/)?.[1]||'';
 const gallery=html.match(/\.moth-rank-badge\s*\{([^}]+)\}/)?.[1]||'';
 assert.match(announcement,/font-family:\s*inherit/);
 assert.match(announcement,/font-size:\s*inherit/);
 assert.match(announcement,/font-weight:\s*inherit/);
 assert.doesNotMatch(announcement,/Press Start 2P/);
 assert.match(gallery,/font-family:\s*"Press Start 2P"/);
 const colorRules=html.match(/#rankMilestoneGrade(?:\[data-rank="[^"]+"\])?\s*\{[^}]*\}/g)||[];
 assert.equal(colorRules.length,1,'All grades use a single headline color rule');
 assert.match(announcement,/color:\s*#8be8f3/);
 assert.doesNotMatch(announcement,/background-clip|linear-gradient/);
});

test('new rank celebration has only a short Next action, retaining its specimen save button',()=>{
 assert.match(html,/id="rankMilestoneContinueButton" type="button">次へ<\/button>/);
 assert.match(html,/rankMilestoneContinueButton\.textContent = '次へ';/);
 assert.match(html,/rankMilestoneSaveButton\.addEventListener\('click'/);
 assert.match(html,/rankMilestoneContinueButton\.addEventListener\('click', closeRankMilestone\)/);
});

test('rank headline adds exactly one ASCII space on either side of the grade',()=>{
 const expected = '<h2 id="rankMilestoneTitle">ギタイ度 <span id="rankMilestoneGrade">C</span> ランク発生！！！</h2>';
 assert.equal(html.split(expected).length-1,1);
});

test('Next progresses across mutation specimens, then exits to rank/gallery when last',()=>{
 const begin=html.indexOf('  function advanceMutationReveal() {');
 const end=html.indexOf('  function showGenerationGenerating() {',begin);
 assert.ok(begin>=0&&end>begin,'mutation advance function exists');
 const fragment=html.slice(begin,end);
 const state={mutationRevealItems:[{index:1},{index:2}],mutationRevealIndex:0};
 const overlay={
   visible:true,
   classList:{
     contains:()=>overlay.visible,
     remove:()=>{overlay.visible=false;}
   }
 };
 let rendered=0,cleared=0,departed=0;
 const advance=new Function(
   'state','mutationRevealOverlay','renderMutationRevealItem','clearPendingMutationEvent','showRankMilestoneOrGallery',
   fragment+';return advanceMutationReveal;'
 )(state,overlay,()=>rendered++,()=>cleared++,()=>departed++);
 advance();
 assert.equal(state.mutationRevealIndex,1);
 assert.equal(rendered,1);
 assert.equal(departed,0);
 advance();
 assert.equal(state.mutationRevealItems.length,0);
 assert.equal(overlay.visible,false);
 assert.equal(cleared,1);
 assert.equal(departed,1);
});

test('specimen box shares the generation badge and persists the original played score',()=>{
 const specimen=html.slice(html.indexOf('  async function showSpecimenBox() {'),html.indexOf('  function readHitColor(',html.indexOf('  async function showSpecimenBox() {')));
 const save=html.slice(html.indexOf('  async function saveSpecimen('),html.indexOf('  function releaseSpecimenObjectUrls()',html.indexOf('  async function saveSpecimen(')));
 assert.match(specimen,/mount\.appendChild\(createMothRankBadge\(savedScore\)\)/);
 assert.match(specimen,/Number\.isFinite\(record\.temporary_rank_score\)/);
 assert.match(specimen,/state\.temporaryMothRanks\.get/);
 assert.match(save,/temporary_rank_score: rankScore/);
 assert.match(save,/if \(!Number\.isFinite\(existing\.temporary_rank_score\) && hasRankScore\)/);
 assert.match(html,/\.specimen-card-mount\s*\{\s*position:\s*relative;/);
});
test('rank badge colors follow D gray, C green, B yellow, A light-blue, S purple, SS rainbow',()=>{
 const colors={D:'#777777',C:'#5bc97c',B:'#f4d65e',A:'#8dddfa',S:'#9860d6'};
 for(const [rank,color] of Object.entries(colors)){
  const rule=html.match(new RegExp('\\.moth-rank-badge\\[data-rank="'+rank+'"\\] \\{([^}]+)\\}'));
  assert.ok(rule,'missing '+rank+' palette');
  assert.ok(rule[1].includes('background: '+color),rank+' must have '+color);
 }
 assert.match(html,/\.moth-rank-badge\[data-rank="SS"\]\s*\{[^}]*linear-gradient\(135deg,/s);
 assert.match(html,/const rank = temporaryRank\(score\);/);
 assert.match(html,/if \(!Number\.isFinite\(score\)\) return null;/);
 assert.match(html,/if \(score >= 90\) return 'SS'/);
});
