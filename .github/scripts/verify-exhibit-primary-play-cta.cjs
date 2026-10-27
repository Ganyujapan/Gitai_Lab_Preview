'use strict';
// UI regression: exhibition play must remain the conspicuous primary action,
// with free space for a future thumbnail; the theater stays secondary.
// No game, IndexedDB, navigation, or evolution state is changed.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('exhibit/modes.html','utf8');
const base=fs.readFileSync('exhibit/landing.css','utf8');
const css=fs.readFileSync('exhibit/theater_canvas_20261026.css','utf8');
function rule(selector){
 const start=css.indexOf(selector+'{');
 assert.ok(start>=0,'missing CSS selector: '+selector);
 const end=css.indexOf('}',start);
 assert.ok(end>start);
 return css.slice(start+selector.length+1,end);
}
const primary=rule('.mode-play .arrow');
const warning=rule('.mode:nth-child(2) .mode-play .arrow');
const theater=rule('.mode-theater-button');
const theaterWarning=rule('.mode:nth-child(2) .mode-theater-button');
assert.match(primary,/display:inline-flex/);
assert.match(primary,/justify-self:end/);
assert.match(primary,/min-height:52px/);
assert.match(primary,/margin-top:clamp\(20px,4vw,30px\)/,
  'keep empty space above CTA for the future moth thumbnail');
assert.match(primary,/font-weight:850/);
assert.match(theater,/background:transparent/);
assert.match(theaterWarning,/background:transparent/);
assert.match(base,/\.mode\{display:grid/);
assert.equal((html.match(/class="mode-play"/g)||[]).length,2);
assert.equal((html.match(/class="arrow">プレイする →/g)||[]).length,2);
assert.equal((html.match(/class="mode-theater-button"/g)||[]).length,2);
assert.ok(html.indexOf('プレイする →')<html.indexOf('進化シアターを見る ▶'),
  'start action must precede theater within each card');
for(const token of [
 'game.html?model=continuous_v1&amp;env=kusagi_001&amp;run=konchu2026_cryptic&amp;play=1',
 'experiment=warning_color&amp;run=warning_color_fog_v2&amp;fog=1&amp;play=1&amp;tutorial=1',
 'id="exhibitGenerationCryptic"','id="exhibitGenerationWarning"',
 'data-view-theater="cryptic"','data-view-theater="warning"'
])assert.ok(html.includes(token),'mode destination or secondary action altered: '+token);
function color(selector,key){
 const rx=new RegExp('(?:^|;)\\s*'+key+'\\s*:\\s*(#[0-9a-fA-F]{6})');
 const match=rule(selector).match(rx);
 assert.ok(match,selector+' '+key+' color');
 return match[1];
}
function luminance(hex){
 const n=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
  .map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
 return n[0]*0.2126+n[1]*0.7152+n[2]*0.0722;
}
function contrast(a,b){
 const [l1,l2]=[luminance(a),luminance(b)].sort((x,y)=>y-x);
 return (l1+0.05)/(l2+0.05);
}
const crypticRatio=contrast(color('.mode-play .arrow','background'),
 color('.mode-play .arrow','color'));
const warningRatio=contrast(color('.mode:nth-child(2) .mode-play .arrow','background'),
 color('.mode:nth-child(2) .mode-play .arrow','color'));
assert.ok(crypticRatio>=7,'cryptic primary play CTA low contrast '+crypticRatio);
assert.ok(warningRatio>=7,'warning primary play CTA low contrast '+warningRatio);
// The theater label remains legible but uses transparent/outline treatment.
assert.match(theater,/font-weight:650/);
console.log('Exhibition: two visually prominent high-contrast play CTAs, space for thumbnails, theater secondary, original layout and links unchanged.');
