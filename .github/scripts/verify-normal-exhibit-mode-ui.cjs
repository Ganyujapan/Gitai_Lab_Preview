'use strict';
// Safe visual-only transplant for the NORMAL game. Exhibit title markup stays untouched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('index.html','utf8');
const exhibitTitle = fs.readFileSync('exhibit/index.html','utf8');
const source = fs.readFileSync('js/entertainment_portal.js','utf8');
const css = fs.readFileSync('css/portal_exhibit_modes.css','utf8');
const exhibitModes = fs.readFileSync('exhibit/modes.html','utf8');
assert.match(html,/href="css\/portal_exhibit_modes\.css\?v=20261111-mode-cards1"/);
assert.match(html,/id="portalSolo"/);
assert.match(html,/id="portalShared"/);
assert.match(html,/id="portalMystery"/);
assert.match(html,/id="portalNickname"/);
assert.match(html,/id="portalEvolutionBack"/);
assert.match(html,/id="specimenBoxButton"/);
assert.match(html,/id="portalAuthorNews"/);
const portalBegin = '<section id="entertainmentPortal"';
const portalEnd = '</section>\n  </main>';
function getPortal(page) {
  const start=page.indexOf(portalBegin), end=page.indexOf(portalEnd,start);
  assert.ok(start>=0 && end>start, 'portal must exist in both documents');
  return page.slice(start,end);
}
assert.equal(getPortal(html), getPortal(exhibitTitle),
  'exhibit and public must keep identical original title markup');
assert.match(html,/id="portalCrypticMode"/);
assert.match(html,/id="portalWarningMode"/);
assert.match(source,/function hydrateNormalModeCards\(\)/);
assert.match(source,/path\.endsWith\('\/'\) \|\| path\.endsWith\('\/index\.html'\)/);
assert.match(source,/path\.includes\('\/exhibit\/'\)/);
assert.match(source,/hydrateNormalModeCards\(\);\s*experimentModes\.hidden = false/);
assert.match(source,/list\.insertAdjacentElement\('beforebegin', lead\)/);
assert.match(source,/button\.innerHTML =/);
for(const item of [
 {id:'portalCrypticMode',name:'隠れるギタイ',sub:'隠蔽擬態',style:'portal-experiment-cryptic',
  banner:'gitailab_thumbnail_hide_960x300.webp'},
 {id:'portalWarningMode',name:'目立つギタイ',sub:'警告色の進化とベイツ型擬態',style:'portal-experiment-warning',
  banner:'gitailab_thumbnail_warning_960x300.webp'}
]){
 assert.ok(html.includes('id="'+item.id+'"'),'original button not removed '+item.id);
 assert.ok(source.includes("'"+item.style+"'"),'new style '+item.id);
 assert.ok(source.includes("'"+item.name+"'"),'label '+item.id);
 assert.ok(source.includes("'"+item.sub+"'"),'subtitle '+item.id);
 assert.ok(source.includes("'"+item.banner+"'"),'banner '+item.id);
 assert.ok(exhibitModes.includes('src="img/modeselect/'+item.banner+'"'),
   'same original exhibit visual source');
 assert.ok(fs.statSync('img/modeselect/'+item.banner).size>1000,
   'must have real WebP image');
}
assert.match(source,/solo\.addEventListener\('click', openEvolutionModePicker\)/);
assert.match(source,/crypticMode\?\.addEventListener\('click', \(\) => \{/);
assert.match(source,/warningMode\?\.addEventListener\('click', \(\) => \{/);
assert.match(source,/beginSoloTutorial\(\)/);
assert.match(source,/beginWarningExperiment\(\)/);
assert.match(source,/showEnvironmentPicker\(\)/);
assert.match(source,/url\.searchParams\.set\('run', 'warning_color_fog_v2'\)/);
assert.match(source,/if \(!experimentModes\?\.querySelector\('img\[data-experiment-moth\]'\)\) return/);
assert.match(css, /#entertainmentPortal \.portal-menu \.portal-experiment-button/);
assert.match(css, /#entertainmentPortal \.portal-experiment-thumbnail/);
assert.match(css, /#entertainmentPortal \.portal-experiment-warning \.portal-experiment-action/);
assert.match(css, /@media \(max-width: 410px\)/);
assert.match(css, /@media \(max-height: 620px\)/);
console.log('Normal UI: exhibition mode cards use original buttons and source WebPs, preserve shared exhibit DOM and normal state/flows.');
