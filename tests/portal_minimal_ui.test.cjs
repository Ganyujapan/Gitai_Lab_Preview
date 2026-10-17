'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const minimal=fs.readFileSync(path.join(root,'css/portal_minimal.css'),'utf8');
const oldMenu=fs.readFileSync(path.join(root,'css/entertainment_portal.css'),'utf8');
const oldHabitat=fs.readFileSync(path.join(root,'css/portal_trophies.css'),'utf8');
const portal=fs.readFileSync(path.join(root,'js/entertainment_portal.js'),'utf8');
const trophy=fs.readFileSync(path.join(root,'js/portal_trophies.js'),'utf8');
const battle=fs.readFileSync(path.join(root,'js/battle_portal.js'),'utf8');
test('minimal design is loaded after the existing styles, without removing core engine',()=>{
 const original=html.indexOf('css/entertainment_portal.css');
 const existing=html.indexOf('css/portal_trophies.css');
 const modern=html.indexOf('css/portal_minimal.css?v=20261017-minimal1');
 assert.ok(original>=0&&existing>original&&modern>existing);
 assert.match(html,/id="gameCanvas"/);
 assert.match(html,/id="portalSolo"/);
 assert.match(html,/id="portalShared"/);
 assert.match(html,/id="portalMystery"/);
 assert.match(html,/id="portalNickname"/);
 assert.match(html,/INVISILAB \/ MODE SELECT/);
 assert.match(html,/class="portal-menu-heading">ギタイラボ/);
});
test('new menus hide only the old menu artwork, not the intro animation',()=>{
 assert.match(minimal,/#entertainmentPortal:not\(\.portal-line-mode\) > \.portal-art/);
 assert.match(minimal,/#entertainmentPortal:not\(\.portal-line-mode\) > \.portal-noise/);
 assert.match(minimal,/#entertainmentPortal:not\(\.portal-line-mode\) > \.portal-frame/);
 assert.doesNotMatch(minimal,/#entertainmentPortal\s*>\s*\.portal-art/);
 assert.match(minimal,/#entertainmentPortal \.portal-menu\s*\{[^}]*background:\s*#080a0b/s);
 assert.match(minimal,/#entertainmentPortal \.portal-menu \.portal-mode\s*\{[^}]*border-radius:\s*12px/s);
 assert.match(oldMenu,/\.portal-line-mode/);
});
test('habitat picker retains functional buttons and thumbnail imagery with black theme',()=>{
 assert.match(trophy,/e\.asset/);
 assert.match(trophy,/card\.addEventListener\('click'/);
 assert.match(trophy,/const action=choose;close\(\);action\(e\.id\)/);
 assert.match(minimal,/#entertainmentPortal \.portal-menu \.portal-environments\s*\{[^}]*background:\s*#080a0b/s);
 assert.match(minimal,/#entertainmentPortal \.portal-menu \.portal-environment-card\s*\{[^}]*border-radius:\s*11px/s);
 assert.match(minimal,/touch-action:\s*pan-y pinch-zoom/);
 assert.match(oldHabitat,/#entertainmentPortal \.portal-environments/);
});
test('battle picker inherits black theme but preserves genome transfer flow',()=>{
 assert.match(battle,/selectedGenome|chosen\.genome/);
 assert.match(battle,/window\.location\.assign\('http:\/\/192\.168\.1\.25:3000\/#battle='/);
 assert.match(minimal,/#entertainmentPortal \.portal-menu #battlePicker\s*\{[^}]*background:\s*#080a0b/s);
 assert.match(minimal,/#entertainmentPortal \.portal-menu #battlePicker #battleStartMatch/);
 assert.match(portal,/function startSolo\(\)/);
 assert.match(portal,/function showEnvironmentPicker\(\)/);
});
test('the old pixel art renderer stops in the new static menu, but resumes on intro',()=>{
 assert.match(portal,/document.hidden \|\| portal.hidden \|\| mode !== 'intro'/);
 assert.match(portal,/const introResolution = nextMode === 'intro'/);
 assert.match(html,/js\/entertainment_portal.js\?v=20261017-minimal1/);
});
