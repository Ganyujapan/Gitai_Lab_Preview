'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');

function fragment(a,b){
 const p=html.indexOf(a),q=html.indexOf(b,p+a.length);
 assert.ok(p>=0&&q>p,'missing '+a);return html.slice(p,q);
}
test('solo fifth round follows shutter, mutation pages, and optional new-rank announcement',()=>{
 const last=fragment('  function endRound() {','  function createEvolutionMothButton(');
 assert.match(last,/playEndOfGenerationShutter\(async \(\) => \{[\s\S]*?showResults\(\);[\s\S]*?await calculatePlayedGenerationRanks\(\);[\s\S]*?selectNewRankMilestone\(scores\);/);
 assert.match(last,/if \(state\.pendingMutationEvent\) \{\s*showMutationReveal\(\);\s*\} else \{\s*showRankMilestoneOrGallery\(\);/);
 assert.match(html,/mutationRevealContinueButton\.addEventListener\('click', \(event\) => \{\s*event\.stopPropagation\(\);\s*advanceMutationReveal\(\)/);
 assert.match(html,/id="mutationRevealContinueButton"[^>]*>次の蛾へ/);
});

test('gallery buttons stay above its scrolling grid; theater button follows last moth',()=>{
 const panel=fragment('<section id="evolutionOverlay"','<section id="theaterOverlay"');
 const top=panel.indexOf('id="evolutionSpecimenButton"');
 const next=panel.indexOf('id="evolutionNextButton"');
 const scroll=panel.indexOf('class="evolution-scroll"');
 const grid=panel.indexOf('id="evolutionLatestGrid"');
 const theater=panel.indexOf('id="evolutionTheaterButton"');
 assert.ok(top>0&&next>top&&scroll>next&&grid>scroll&&theater>grid);
 assert.match(html,/evolutionScroller\.addEventListener\('scroll', revealEvolutionTheaterAtBottom/);
 assert.match(html,/if \(atEnd\) evolutionTheaterButton\.hidden = false/);
 assert.match(html,/evolutionSpecimenButton\.addEventListener\('click'[\s\S]*?showSpecimenBox\(\)/);
 assert.match(html,/evolutionNextButton\.addEventListener\('click'[\s\S]*?continueFromEvolutionList\(\)/);
 assert.match(html,/continueButton\.click\(\)/);
});
test('left dot-style rank is actual-play camouflage score, not arbitrary rarity or trophies',()=>{
 assert.match(html,/className = 'moth-rank-badge'/);
 assert.match(html,/button\.dataset\.mothIndex = String\(index\)/);
 assert.match(html,/mothPositions\.set\(m\.index, m\)/);
 assert.match(html,/for \(const button of targets\)/);
 assert.match(html,/analyzeGitaiPlacement\(\s*buildMothAnalysis\(image\), bgData, m\.x, m\.y, m\.size/s);
 for(const grade of ['D','C','B','A','S','SS'])
   assert.match(html,new RegExp('data-rank="'+grade+'"'));
 assert.match(html,/\.moth-rank-badge\s*\{[^}]*left:\s*6px/s);
 assert.match(html,/\.predation-skull\s*\{[^}]*right:\s*6px/s);
 assert.match(html,/\.moth-rank-badge\[data-rank="SS"\]\s*\{[^}]*linear-gradient/s);
 assert.match(html,/This is not the separately calibrated S\/SS trophy system/);
});
test('gallery is break between generations: original persistence and theater stay operational',()=>{
 assert.match(html,/if \(!isEntertainmentModel\(\) \|\| state\.submitStatus !== 'ready' \|\| state\.uiTransitionLocked\) return;/);
 assert.match(html,/evolutionOverlay\.classList\.remove\('visible'\);\s*continueButton\.click\(\);/);
 assert.match(html,/async function showEvolutionTheater\(\)/);
 assert.match(html,/async function sendEvolutionData\(\)/);
 assert.match(html,/async function saveSpecimen\(/);
});

test('gallery heading displays current generation and removes two explanatory paragraphs',()=>{
 assert.match(html,/id="evolutionTitle" class="evolution-title">第1世代の蛾/);
 assert.ok(html.includes('evolutionTitle.textContent = `第${latestNumber}世代の蛾`;'));
 assert.doesNotMatch(html,/class="evolution-hint"|class="evolution-rank-note"/);
});
test('rank badge and skull share flat frame, letters use a loaded pixel font',()=>{
 const rank=html.match(/\.moth-rank-badge\s*\{([^}]+)\}/)?.[1]||'';
 const skull=html.match(/\.predation-skull\s*\{([^}]+)\}/)?.[1]||'';
 for(const v of ['width: 24px','height: 24px','border: 1px solid rgba(255,255,255,0.76)','border-radius: 4px','box-shadow: none','text-shadow: none'])assert.ok(rank.includes(v),v);
 for(const v of ['width: 24px','height: 24px','border: 1px solid rgba(255,255,255,0.76)','border-radius: 4px'])assert.ok(skull.includes(v),v);
 assert.ok(html.includes('fonts.googleapis.com/css2?family=Press+Start+2P'));
 assert.ok(rank.includes('font-family: "Press Start 2P"'));
 assert.match(html,/\.moth-rank-badge\[data-rank="SS"\][\s\S]*?linear-gradient/);
});

test('generation list continue button uses the concise label 次へ',()=>{
 assert.ok(html.includes('<button id="evolutionNextButton" type="button">次へ</button>'));
 assert.ok(!html.includes('id="evolutionNextButton" type="button">次の世代へ'));
});
