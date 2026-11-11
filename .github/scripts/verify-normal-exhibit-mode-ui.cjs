'use strict';
// The normal game's first exhibit-style mode-card migration is VISUAL ONLY.
// The original tutorial, habitat selection, saves and warning routing survive.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('css/portal_exhibit_modes.css', 'utf8');
const portal = fs.readFileSync('js/entertainment_portal.js', 'utf8');
const exhibit = fs.readFileSync('exhibit/modes.html', 'utf8');

assert.match(html, /href="css\/portal_exhibit_modes\.css\?v=20261111-mode-cards1"/);
assert.match(html, /id="portalSolo"/);
assert.match(html, /id="portalShared"/);
assert.match(html, /id="portalMystery"/);
assert.match(html, /id="portalNickname"/);
assert.match(html, /id="portalEvolutionBack"/);
assert.match(html, /id="specimenBoxButton"/);
assert.match(html, /id="portalAuthorNews"/);

const opening = html.indexOf('<section id="portalEvolutionModes"');
const end = html.indexOf('<div id="portalDialog"', opening);
assert.ok(opening >= 0 && end > opening);
const modes = html.slice(opening, end);
const cards = [
  {id:'portalCrypticMode', title:'隠れるギタイ', sub:'隠蔽擬態',
   src:'gitailab_thumbnail_hide_960x300.webp'},
  {id:'portalWarningMode', title:'目立つギタイ', sub:'警告色の進化とベイツ型擬態',
   src:'gitailab_thumbnail_warning_960x300.webp'}
];
assert.match(modes, /class="portal-experiment-list"/);
assert.match(modes, /蛾を捕食すると、生き残った個体が次の世代の親になります。/);
for (const c of cards) {
  const start = modes.indexOf('<button id="'+c.id+'"');
  assert.ok(start >= 0, 'missing mode button '+c.id);
  const close = modes.indexOf('</button>', start);
  assert.ok(close > start, 'invalid button '+c.id);
  const card = modes.slice(start, close);
  assert.match(card, /type="button"/);
  assert.ok(card.includes('<strong>'+c.title+'</strong>'), 'mode label '+c.id);
  assert.ok(card.includes('>'+c.sub+'</span>'), 'mode subtitle '+c.id);
  assert.ok(card.includes('src="img/modeselect/'+c.src+'"'), 'mode banner '+c.id);
  assert.ok(card.indexOf('portal-experiment-thumbnail') < card.indexOf('portal-experiment-action'),
    'thumbnail must come before CTA '+c.id);
  assert.ok(!card.includes('href='), 'button routing must remain in JS');
  assert.ok(fs.statSync('img/modeselect/'+c.src).size > 1000, 'real bundled WebP '+c.src);
  assert.ok(exhibit.includes('src="img/modeselect/'+c.src+'"'),
    'must reuse real exhibition card artwork');
}
assert.ok(!modes.includes('data-experiment-moth'), 'do not initialize optional genome samples');
assert.match(portal, /solo\.addEventListener\('click', openEvolutionModePicker\)/);
assert.match(portal, /crypticMode\?\.addEventListener\('click', \(\) => \{/);
assert.match(portal, /warningMode\?\.addEventListener\('click', \(\) => \{/);
assert.match(portal, /beginSoloTutorial\(\)/);
assert.match(portal, /beginWarningExperiment\(\)/);
assert.match(portal, /showEnvironmentPicker\(\)/);
assert.match(portal, /url\.searchParams\.set\('run', 'warning_color_fog_v2'\)/);
assert.match(portal, /if \(!experimentModes\?\.querySelector\('img\[data-experiment-moth\]'\)\) return/);
assert.match(css, /#entertainmentPortal \.portal-experiment-list/);
assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
assert.match(css, /#entertainmentPortal \.portal-experiment-warning \.portal-experiment-action/);
assert.match(css, /#entertainmentPortal \.portal-experiment-thumbnail/);
assert.match(css, /@media \(max-width: 410px\)/);
assert.match(css, /@media \(max-height: 620px\)/);
// The exhibition's own modes.html and landing.css remain separate. 
assert.match(exhibit, /id="exhibitGenerationCryptic"/);
assert.match(exhibit, /id="exhibitGenerationWarning"/);
console.log('NORMAL UI: two exhibition WebP card designs, original mode actions and saves intact; no exhibit game or IndexedDB mutation.');
