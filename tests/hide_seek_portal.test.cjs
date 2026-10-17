'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const dir=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(dir,'js/hide_seek_portal.js'),'utf8');
const css=fs.readFileSync(path.join(dir,'css/hide_seek_portal.css'),'utf8');
const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
test('hide-and-seek is test-only until battle 10 wins; uses its own 4 slides',()=>{
 assert.match(src,/id='portalHideSeek'/);
 assert.match(src,/DEV=params\.get\('hideSeekTest'\)==='1'/);
 assert.match(src,/通算10勝で解放されます/);
 assert.match(src,/GitaiSoloTutorial\.open\(\{mode:'hide',onDone:show\}\)/);
});
test('three distinct DNA specimens are selected without changing specimen box',()=>{
 assert.match(src,/indexedDB\.open\('gitai-specimen-box-v1',1\)/);
 assert.match(src,/r\.genome\?\.schema_version===1/);
 assert.match(src,/r\.image_blob instanceof Blob/);
 assert.match(src,/else if\(selected\.length<3\)selected\.push\(entry\)/);
 assert.match(src,/advance\.disabled=selected\.length!==3/);
 assert.doesNotMatch(src,/localStorage\.setItem|\.put\(/);
});
test('all three habitats allow independent moth placement and no reward on the test route',()=>{
 assert.match(src,/stages=\['leaf1','leaf2','bark'\]/);
 assert.match(src,/positions=\[null,null,null\]/);
 assert.match(src,/positions\[slot\]=\{background:stages\[stage\]/);
 assert.match(src,/advance\.disabled=count!==3/);
 assert.match(src,/selected\[i\]\.genome/);
 assert.match(src,/192\.168\.1\.25:3000\/hide_seek#hide=/);
 assert.match(css,/#entertainmentPortal #hidePicker\{/);
 assert.match(html,/js\/hide_seek_portal\.js\?v=20261018-hide1/);
 assert.match(html,/css\/hide_seek_portal\.css\?v=20261018-hide1/);
});
