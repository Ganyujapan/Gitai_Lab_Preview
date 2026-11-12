'use strict';
// Normal-only mode cards: test actual DOM construction and PWA exclusion.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const title=fs.readFileSync('exhibit/index.html','utf8');
const controller=fs.readFileSync('js/entertainment_portal.js','utf8');
const code=fs.readFileSync('js/portal_exhibit_mode_cards.js','utf8');
const css=fs.readFileSync('css/portal_exhibit_modes.css','utf8');
const exhibitModes=fs.readFileSync('exhibit/modes.html','utf8');

assert.match(html,/href="css\/portal_exhibit_modes\.css\?v=20261111-mode-cards1"/);
assert.match(html,/src="js\/portal_exhibit_mode_cards\.js\?v=20261112-main-only1" defer/);
for(const id of ['portalSolo','portalShared','portalMystery','portalNickname',
 'portalCrypticMode','portalWarningMode','portalEvolutionBack','specimenBoxButton','portalAuthorNews']){
 assert.ok(html.includes('id="'+id+'"'),'keep original portal control '+id);
}
const portalStart=html.indexOf('    <section id="entertainmentPortal"');
const portalEnd=html.indexOf('\n  </main>',portalStart);
assert.ok(portalStart>=0 && portalEnd>portalStart);
assert.ok(title.includes(html.slice(portalStart,portalEnd)),
  'original exhibition title DOM must stay unchanged');
assert.match(controller,/solo\.addEventListener\('click', openEvolutionModePicker\)/);
assert.match(controller,/crypticMode\?\.addEventListener\('click', \(\) => \{/);
assert.match(controller,/warningMode\?\.addEventListener\('click', \(\) => \{/);
assert.match(controller,/beginSoloTutorial\(\)/);
assert.match(controller,/beginWarningExperiment\(\)/);
assert.match(controller,/showEnvironmentPicker\(\)/);
assert.match(controller,/url\.searchParams\.set\('run', 'warning_color_fog_v2'\)/);
assert.doesNotMatch(controller,/normalModeCardsHydrated|hydrateNormalModeCards/,
 'shared JS cannot be modified for normal-only styling');
assert.match(css,/#entertainmentPortal \.portal-menu \.portal-experiment-button/);
assert.match(css,/#entertainmentPortal \.portal-experiment-thumbnail/);
assert.match(css,/@media \(max-width: 410px\)/);

function node(tag){
 return {
  tag,className:'',textContent:'',children:[],dataset:{},attrs:{},
  classList:{names:[],add(name){this.names.push(name)}},
  setAttribute(name,value){this.attrs[name]=value},
  replaceChildren(...children){this.children=children},
  insertAdjacentElement(where,child){this.inserted={where,child}}
 };
}
function run(pathname){
 const elements={
  portalCrypticMode:node('button'),
  portalWarningMode:node('button')
 };
 const list=node('div');
 const picker={querySelector(query){
  assert.equal(query,'.portal-experiment-list');return list;
 }};
 elements.portalEvolutionModes=picker;
 const document={
  getElementById:id=>elements[id]||null,
  createElement:tag=>node(tag)
 };
 vm.runInNewContext(code,{document,window:{location:{pathname}}},{timeout:1000});
 return {elements,list};
}
const sample=run('/Gitai_Lab_Preview/');
assert.equal(sample.list.dataset.normalExhibitCards,'1');
assert.equal(sample.list.inserted.child.textContent,
 '蛾を捕食すると、生き残った個体が次の世代の親になります。');
for(const [id,name,sub,banner] of [
 ['portalCrypticMode','隠れるギタイ','隠蔽擬態','gitailab_thumbnail_hide_960x300.webp'],
 ['portalWarningMode','目立つギタイ','警告色の進化とベイツ型擬態','gitailab_thumbnail_warning_960x300.webp']
]){
 const c=sample.elements[id];
 assert.equal(c.children.length,5);
 assert.equal(c.children[1].textContent,name);
 assert.equal(c.children[2].textContent,sub);
 assert.equal(c.children[3].src,'img/modeselect/'+banner);
 assert.equal(c.children[4].textContent,'実験開始 ▶');
 assert.ok(exhibitModes.includes('src="img/modeselect/'+banner+'"'));
 assert.ok(fs.statSync('img/modeselect/'+banner).size>1000,'must have real WebP');
}
assert.equal(run('/Gitai_Lab_Preview/index.html').list.dataset.normalExhibitCards,'1');
const isolated=run('/Gitai_Lab_Preview/exhibit/game.html');
assert.equal(isolated.list.dataset.normalExhibitCards,undefined);
assert.equal(isolated.elements.portalCrypticMode.children.length,0);
assert.equal(isolated.elements.portalWarningMode.children.length,0);
if(fs.existsSync('_site/exhibit/game.html')){
 const game=fs.readFileSync('_site/exhibit/game.html','utf8');
 const precache=fs.readFileSync('_site/exhibit/precache.json','utf8');
 assert.ok(!game.includes('portal_exhibit_mode_cards.js'));
 assert.ok(!game.includes('portal_exhibit_modes.css'));
 assert.ok(!precache.includes('portal_exhibit_mode_cards.js'));
 assert.ok(!precache.includes('portal_exhibit_modes.css'));
 assert.ok(!fs.existsSync('_site/exhibit/js/portal_exhibit_mode_cards.js'));
 assert.ok(!fs.existsSync('_site/exhibit/css/portal_exhibit_modes.css'));
 const ver=JSON.parse(fs.readFileSync('_site/exhibit/version.json','utf8'));
 assert.equal(ver.build,'2bf70e0a3e723d79f3486e973f72fb3abb01931c');
}
console.log('Normal mode UI: rendered exhibition cards, original normal actions, immutable exhibit portal and isolated offline PWA verified.');
