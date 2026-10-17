'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const css=html.slice(html.indexOf('<style>')+7,html.indexOf('</style>'));
const section=html.slice(html.indexOf('  function playEndOfGenerationShutter('),html.indexOf('  function render() {',html.indexOf('  function playEndOfGenerationShutter(')));

test('generation transition is an entire black screen, not a striped mechanical shutter',()=>{
 assert.match(css,/\.round-shutter-panel\s*\{[^}]*background:\s*#080a0b/s);
 assert.doesNotMatch(css,/repeating-linear-gradient\(\s*to bottom/);
 assert.match(html,/class="round-shutter-header">INVISILAB \/ EVOLUTION/);
 assert.match(html,/class="round-shutter-logo">ギタイラボ/);
 assert.match(html,/GENERATION COMPLETE/);
 assert.match(html,/class="round-shutter-message">この世代の結果を準備中/);
 assert.match(html,/@keyframes round-shutter-blink/);
 assert.match(html,/id="roundShutterGeneration"/);
});
test('the whole panel comes down and goes back up at exactly the same speed',()=>{
 const panel=css.match(/\.round-shutter-panel\s*\{([\s\S]*?)\}/);
 assert.ok(panel);
 assert.match(panel[1],/translate3d\(0, -102%, 0\)/);
 assert.match(panel[1],/transition:\s*transform 680ms/);
 assert.match(css,/#roundShutter\.closing \.round-shutter-panel\s*\{[^}]*translate3d\(0, 0, 0\)/s);
 assert.match(css,/#roundShutter\.opening \.round-shutter-panel\s*\{[^}]*translate3d\(0, -102%, 0\)/s);
 assert.doesNotMatch(css,/#roundShutter\.opening \.round-shutter-panel\s*\{[^}]*transition-duration:/s);
 assert.match(section,/const SHUTTER_DOWN_MS = 680;/);
 assert.match(section,/const SHUTTER_HOLD_MS = 1000;/);
 assert.match(section,/const SHUTTER_UP_MS = 680;/);
});
test('shutter blocks stray taps, hides result preparation, and preserves existing result/mutation behavior',()=>{
 assert.match(html,/#roundShutter\.active\s*\{[^}]*pointer-events:\s*auto/s);
 assert.match(section,/roundShutterGeneration\.textContent = generationLabel\(\)/);
 assert.match(section,/if \(typeof onClosed === 'function'\) onClosed\(\)/);
 assert.match(section,/setTimeout\(\(\) => \{[\s\S]*roundShutter\.classList\.remove\('closing'\);[\s\S]*roundShutter\.classList\.add\('opening'\)/);
 assert.match(html,/if \(state\.pendingMutationEvent\) \{\s*showMutationReveal\(\);\s*\} else \{\s*showEvolutionComparison\(\);/);
 assert.match(html,/roundShutter\.addEventListener\('pointerdown', \(event\) => \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\)/);
});
test('reduced motion turns off ornamental blinking without changing the game',()=>{
 assert.match(css,/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.round-shutter-dot \{ animation: none; opacity: 1; \}/);
 assert.match(css,/#roundShutter\.opening/);
});
