'use strict';
// Security regression: never bundle retired battle/hide-seek entry points into
// public preview OR the generated offline exhibition. No user storage touched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2] || '.';
const filename = name => path.join(root, name);
const read = name => fs.readFileSync(filename(name), 'utf8');
const exists = name => fs.existsSync(filename(name));

for (const name of ['js/battle_portal.js', 'js/hide_seek_portal.js',
  'css/hide_seek_portal.css']) {
  assert.equal(exists(name), false, 'Public battle asset must not exist: ' + name);
}
const html = read('index.html');
assert.match(html, /id="portalShared"/, 'Shared evolution preparing UI must remain');
assert.match(html, /id="portalMystery"/, 'Unrelated locked menu must remain');
assert.match(html, /id="specimenBoxButton"/, 'Independent specimen box must remain');
assert.match(html, /js\/experiment_saves\.js\?v=/, 'Experiment saves must remain');
assert.match(html, /js\/ambient_audio\.js\?v=/, 'Rainforest audio must remain');
assert.match(html, /js\/game_sfx\.js\?v=/, 'Recorded effects must remain');

const urls = ['192','168','1','25'].join('.') + ':3000';
const banned = [
  urls, 'hideSeekTest', 'portalBattle', 'portalHideSeek',
  'battlePicker', 'hidePicker', 'battleStartMatch',
  'battle_portal.js', 'hide_seek_portal.js', 'hide_seek_portal.css',
  '#battle=', '#hide='
];
function deployedTexts(base) {
  const files = [];
  for (const item of fs.readdirSync(base, { withFileTypes: true })) {
    const p = path.join(base, item.name);
    if (item.isDirectory()) {
      if (['.git','.github','node_modules'].includes(item.name)) continue;
      files.push(...deployedTexts(p));
    } else if (/\.(?:js|mjs|cjs|html|css|py|json|webmanifest)$/i.test(item.name)) {
      files.push(p);
    }
  }
  return files;
}
for (const file of deployedTexts(root)) {
  // The CI verifier isn't a web-delivered runtime asset.
  if (file.includes('/.github/') || file.endsWith('/verify-battle-seal.cjs')) continue;
  const txt = fs.readFileSync(file, 'utf8');
  for (const term of banned) {
    assert.equal(txt.includes(term), false, 'Forbidden battle path ' + term + ' in ' + file);
  }
}
const tutorial=read('js/solo_tutorial.js');
assert.doesNotMatch(tutorial, /hideSlides|mode==='hide'/,
  'Retired hide-and-seek tutorial must not be reachable');
const minimal=read('css/portal_minimal.css');
assert.doesNotMatch(minimal, /#battlePicker|#battleBack/,
  'Retired battle picker CSS must be removed');
if (exists('exhibit/game.html')) {
  const game = read('exhibit/game.html');
  assert.doesNotMatch(game, /battle_portal\.js|hide_seek_portal\.js|hide_seek_portal\.css/);
  assert.equal(exists('exhibit/js/battle_portal.js'), false);
  assert.equal(exists('exhibit/js/hide_seek_portal.js'), false);
  assert.equal(exists('exhibit/css/hide_seek_portal.css'), false);
  assert.ok(exists('exhibit/js/pages_preview.js'), 'Exhibit game engine intact');
  assert.ok(exists('exhibit/js/experiment_saves.js'), 'Shared assets still present');
}
console.log('Public seal verified: no battle/hide executable, routing, CSS or LAN endpoint; main and exhibit preserved.');
