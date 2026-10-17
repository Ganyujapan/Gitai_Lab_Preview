'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const portal=fs.readFileSync(path.join(__dirname,'../css/entertainment_portal.css'),'utf8');
test('solo predator canvas prevents Safari zoom without changing pointerdown hit logic',()=>{
  assert.match(html,/#gameCanvas\s*\{[^}]*touch-action:\s*none/s);
  assert.match(html,/canvas\.addEventListener\('pointerdown', \(e\) => \{\s*e\.preventDefault\(\);\s*handleTap\(e\.clientX, e\.clientY\);/);
  assert.match(html,/canvas\.addEventListener\('dblclick', \(event\) => \{\s*event\.preventDefault\(\);/);
});
test('menus suppress double-tap zoom while keeping pinch zoom and form interactions available',()=>{
  assert.match(html,/html, body\s*\{[^}]*touch-action:\s*manipulation/s);
  assert.match(html,/#stage\s*\{[^}]*touch-action:\s*manipulation/s);
  assert.match(portal,/#entertainmentPortal\s*\{[^}]*touch-action:\s*manipulation/s);
  assert.doesNotMatch(html,/<meta[^>]+maximum-scale=1/);
});
