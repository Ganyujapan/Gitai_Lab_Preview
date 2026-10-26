'use strict';
// EXH-04: real exhibition return handler isolated for behavior testing.
// No user's IndexedDB or real browser session is touched.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const src=fs.readFileSync('exhibit/game.js','utf8');
const css=fs.readFileSync('exhibit/game.css','utf8');
for(const id of ['portalBackToMenu','soloHomeButton','resultBackToMenu']){
 assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,
   'Exhibition game.html inherits existing production button: '+id);
}
assert.equal((html.match(/id="backToMenu"/g)||[]).length,0);
assert.doesNotMatch(css,/#backToMenu/,'No obsolete selector');
assert.match(css,/#resultBackToMenu/,'Existing results button still hidden');
const beginning=src.indexOf("  document.getElementById('portalBackToMenu')?.addEventListener");
const ending=src.indexOf("  document.getElementById('resetConfirmButton')",beginning);
assert.ok(beginning>=0&&ending>beginning);
const code=src.slice(beginning,ending);
assert.doesNotMatch(code, /'backToMenu'/);
assert.match(src,/if \(handoverPending/);
assert.match(src,/void safelyHandover\(\)/);
assert.match(src,/window.addEventListener\('gitai:warning-death-return'/);
function fixture({start=true,review=false,pending=false}={}){
 const listeners={},destinations=[],effects={prevented:0,stopped:0,handover:0};
 const elements=Object.fromEntries(['portalBackToMenu','soloHomeButton','resultBackToMenu'].map(k=>[k,{
   addEventListener:(type,fn,capture)=>{assert.equal(type,'click');assert.equal(capture,true);listeners[k]=fn}
 }]));
 const context={
  document:{getElementById:id=>elements[id]},
  home:{href:'https://example.test/Gitai_Lab_Preview/exhibit/'},
  location:{assign:url=>destinations.push(url)},
  handoverPending:pending,
  startOverlay:{classList:{contains:()=>start}},
  reviewOverlay:{classList:{contains:()=>review}},
  safelyHandover:async()=>{effects.handover++}
 };
 vm.runInNewContext(code,context);
 const click=id=>{
  const event={preventDefault(){effects.prevented++},stopImmediatePropagation(){effects.stopped++}};
  listeners[id](event);
 };
 return {click,destinations,effects};
}
const before=fixture();
before.click('portalBackToMenu');
assert.deepEqual(before.destinations,['https://example.test/Gitai_Lab_Preview/exhibit/']);
assert.equal(before.effects.stopped,1,'The production portal/pause handler must not run');
const busy=fixture({review:true,start:false});
busy.click('portalBackToMenu');
assert.equal(busy.destinations.length,0,'Cannot exit a committed result unsafely');
busy.click('resultBackToMenu');
assert.equal(busy.effects.handover,1,'Results must go through saved-data handover');
const mid=fixture({start:false,review:false});
mid.click('soloHomeButton');
assert.equal(mid.destinations.length,0,'Do not discard a mid-round generation');
const pending=fixture({start:true,pending:true});
pending.click('portalBackToMenu');
assert.equal(pending.destinations.length,0,'During save no exit');
const saved=fixture({review:true,start:false,pending:true});
saved.click('resultBackToMenu');
assert.equal(saved.effects.handover,0,'Do not start a duplicate handover');
assert.match(src,/continueButton\.click\(\)/);
assert.match(src,/sessionStorage\.setItem\(HANDOVER_KEY/);
console.log('EXH-04: Real button IDs, pre-start return without pause, in-flight save guard and result-only handover OK');
