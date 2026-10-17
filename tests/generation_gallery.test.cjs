'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');

function fragment(a,b){
 const p=html.indexOf(a),q=html.indexOf(b,p+a.length);
 assert.ok(p>=0&&q>p,'missing '+a);return html.slice(p,q);
}
test('solo fifth round leads straight to gallery, via mutation reveal when present',()=>{
 const last=fragment('  function endRound() {','  function createEvolutionMothButton(');
 assert.match(last,/playEndOfGenerationShutter\(\(\) => \{\s*showResults\(\);\s*if \(state\.pendingMutationEvent\) \{\s*showMutationReveal\(\);\s*\} else \{\s*showEvolutionComparison\(\);/);
 assert.match(html,/mutationRevealContinueButton\.addEventListener\('click', \(\) => \{\s*mutationRevealOverlay\.classList\.remove\('visible'\);\s*clearPendingMutationEvent\(\);\s*showEvolutionComparison\(\);/);
 assert.match(html,/id="mutationRevealContinueButton"[^>]*>プレイした世代を見る/);
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
