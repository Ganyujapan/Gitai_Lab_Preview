'use strict';
// Exhibition: user-authored mode thumbnails must be real WebP images,
// appear once per card and be precached for completely offline iPad play.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const html = fs.readFileSync(path.join(root, 'exhibit/modes.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'exhibit/landing.css'), 'utf8');
const build = fs.readFileSync(path.join(root, 'exhibit/build.py'), 'utf8');
const images = [
  {name: 'gitailab_thumbnail_hide_960x300.webp', mode: 'cryptic',
    title: '隠れるギタイ'},
  {name: 'gitailab_thumbnail_warning_960x300.webp', mode: 'warning',
    title: '目立つギタイ'}
];
const signatures = [];
for (const {name,mode,title} of images) {
  const file = path.join(root, 'img/modeselect', name);
  const data = fs.readFileSync(file);
  assert.ok(data.length > 2000 && data.length < 80000,
    'WebP banner must contain authored image bytes: ' + name);
  assert.equal(data.toString('ascii',0,4), 'RIFF');
  assert.equal(data.toString('ascii',8,12), 'WEBP');
  assert.equal(data.toString('ascii',12,16), 'VP8 ');
  assert.equal(data.readUInt32LE(4) + 8, data.length, 'complete RIFF container');
  assert.equal(data.toString('hex',23,26), '9d012a');
  assert.equal(data.readUInt16LE(26)&0x3fff, 960);
  assert.equal(data.readUInt16LE(28)&0x3fff, 300);
  signatures.push(data.subarray(40,140).toString('hex'));
  const url = 'img/modeselect/' + name;
  assert.equal(html.split('src="'+url+'"').length-1,1, url);
  assert.match(build,new RegExp(name.replaceAll('.', '\\.'), 'g'));
  const card = html.match(new RegExp(
    '<article class="mode" data-exhibit-mode="'+mode+'">([\\s\\S]*?)<\\/article>'));
  assert.ok(card, 'card not found: '+mode);
  assert.match(card[1], new RegExp('src="'+url.replaceAll('.', '\\.')+'"'));
  assert.ok(card[1].includes('<strong>'+title+'</strong>'));
  assert.match(card[1], /class="mode-theater-button"/);
  assert.match(card[1], /class="mode-play"/);
  assert.ok(card[1].indexOf('class="mode-thumbnail"') <
    card[1].indexOf('</a>'), 'thumbnail must be within play link');
}
assert.notEqual(signatures[0], signatures[1], 'distinct mode banners required');
assert.match(build,/shutil\.copytree\(site \/ folder, exhibit \/ folder/);
assert.match(build,/assert artifact in runtime_files/);
assert.match(build,/modes_source\.count\("img\/modeselect\/"/);
assert.match(css,/#exhibitModeSelection \.mode-thumbnail/);
assert.match(css,/#exhibitModeSelection \.mode-play:focus-visible/);
assert.match(css,/#exhibitModeSelection \.mode-theater-actions/);
assert.match(css,/@media \(max-width:410px\)/);
console.log('Konchu University: 2 distinct valid 960x300 WebP mode banners, correct cards, offline bundle and tap targets verified.');
