'use strict';
// EXH-F01: test the ACTUAL PIN-gated multipart file verification helper.
// Only synthetic file descriptors, no indexedDB/localStorage access or mutation.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const admin=fs.readFileSync('exhibit/admin.js','utf8');
const html=fs.readFileSync('exhibit/modes.html','utf8');
const start=admin.indexOf('  async function verifySavedMultipartFiles(files, selected) {');
const end=admin.indexOf("\n  const button = document.getElementById('exhibitAdminOpen');",start);
assert(start>0&&end>start,'Production readonly helper is missing');
const actual=admin.slice(start,end);
assert.doesNotMatch(actual,/indexedDB|openDb\(|db\.transaction|\.put\(|\.clear\(|\.delete\(|restoreMode\(|localStorage|upgrade/i,
 'Read-only verifier must NEVER touch or upgrade real game data');
assert.match(html,/id="exhibitBackupV2Files"[^>]*multiple/);
assert.match(html,/src="backup_v2\.js" defer/);
assert.match(html,/src="backup_restore_preflight_v2\.js" defer/);
assert.ok(html.indexOf('src="backup_v2.js"')<html.indexOf('src="admin.js"'));
assert.ok(html.indexOf('src="backup_restore_preflight_v2.js"')<html.indexOf('src="admin.js"'));
assert.match(html,/href="backup_rehearsal\.html"/);
assert.doesNotMatch(html,/src="backup_restore_atomic_v2\.js"/);
assert.doesNotMatch(html,/src="backup_checkpoint_v2\.js"/);
const manifest={name:'manifest.json',size:1000};
const part1={name:'part-00000.json',size:800};
const part2={name:'part-00001.json',size:900};
const cryptic='gitai-exhibit-2026-gitai-pages-preview-v3-kusagi_001-continuous_v1-konchu2026_cryptic';
const warning='gitai-exhibit-2026-gitai-pages-preview-v3-kusagi_001-continuous_v1-warning_color_fog_v2';
function harness({output,throws,semanticAvailable=true}={}){
 let called=0,args=null;
 const checkGenome=()=>{},checkMothPng=async()=>{};
 const semanticApi={preflightRestore:async opts=>{
   called++;args=opts;if(throws)throw Error(throws);
   return output||{semanticChecked:true,safeToRestore:false,checkedPngs:60,checkedGenomes:60,
     mode:opts.mode,generation:'gen00044',entries:151};
 }};
 const context={
   MODES:{cryptic:{db:cryptic},warning:{db:warning}},
   window:{
     GitaiBackupV2:{MAX_MANIFEST_BYTES:1024*1024,MAX_PART_BYTES:8*1024*1024,
       validateManifest:()=>{}},
     GitaiBackupRestorePreflightV2:semanticAvailable?semanticApi:null
   },checkGenome,checkMothPng,Error,Object,Array,Number
 };
 vm.runInNewContext(actual+"\nglobalThis.verify=verifySavedMultipartFiles;",context,
   {filename:'exhibit/admin.js:verifySavedMultipartFiles',timeout:3000});
 return {verify:context.verify,called:()=>called,args:()=>args,checkGenome,checkMothPng};
}
(async()=>{
 const a=harness();
 const ok=await a.verify([manifest,part2,part1],'cryptic');
 assert.equal(ok.mode,'cryptic');
 assert.equal(ok.generation,'gen00044');
 assert.equal(ok.entries,151);
 assert.equal(ok.partCount,2);
 assert.equal(ok.safeToRestore,false);
 assert.equal(a.called(),1);
 assert.equal(a.args().database,cryptic);
 assert.equal(a.args().mode,'cryptic');
 assert.equal(a.args().manifestFile,manifest);
 assert.deepEqual(Array.from(a.args().partFiles),[part2,part1]);
 assert.equal(a.args().checkGenome,a.checkGenome);
 assert.equal(a.args().checkMothPng,a.checkMothPng);
 const warn=harness();
 await warn.verify([manifest,part1],'warning');
 assert.equal(warn.args().database,warning);

 for(const input of [
   [manifest],[part1,part2],[{...manifest,name:'Manifest.json'},part1],
   [manifest,manifest,part1],[manifest,{name:'error.txt',size:1}],
   [manifest,{name:'part-00000.json',size:8*1024*1024+1}],
   [manifest,{name:'part-00000.json',size:0}],
   [{name:'manifest.json',size:1024*1024+1},part1]
 ]) {
   const h=harness();
   await assert.rejects(h.verify(input,'cryptic'));
   assert.equal(h.called(),0,'invalid selection must not reach SHA verifier');
 }
 await assert.rejects(harness().verify([manifest,part1],'wrong-mode'),/モード/);
 await assert.rejects(harness({semanticAvailable:false}).verify([manifest,part1],'cryptic'),/検証器/);
 const invalid=harness({output:{semanticChecked:false,safeToRestore:false,
    checkedPngs:60,checkedGenomes:60}});
 await assert.rejects(invalid.verify([manifest,part1],'cryptic'),/完了していません/);
 const unsafe=harness({output:{semanticChecked:true,safeToRestore:true,
   checkedPngs:60,checkedGenomes:60}});
 await assert.rejects(unsafe.verify([manifest,part1],'cryptic'),/完了していません/);
 const incomplete=harness({output:{semanticChecked:true,safeToRestore:false,
   checkedPngs:60,checkedGenomes:59}});
 await assert.rejects(incomplete.verify([manifest,part1],'cryptic'),/完了していません/);
 await assert.rejects(harness({throws:'Checksum mismatch'}).verify([manifest,part1],'cryptic'),/Checksum mismatch/);
 const many=harness();
 await assert.rejects(many.verify({length:8194},'cryptic'),/最大8193/);
 assert.equal(many.called(),0);
 // Mode change or admin lock must cancel stale success UI. No restore/deletion
 // controls are routed through the v2 verifier.
 assert.match(admin,/selection\.request !== preparationId/);
 assert.match(admin,/selector\.value !== selection\.mode/);
 assert.match(admin,/v2FilesInput\.value = ''/);
 assert.match(admin,/これは選択されたファイル群の検証/);
 assert.match(admin,/現在の管理画面から分割ファイルを復元することはできません/);
 console.log('EXH-F01: real production v2 verifier requires manifest+all parts and strictly calls PNG/DNA SHA preflight; wrong mode, incomplete, oversized, stale or unsafe results rejected; zero user DB access.');
})().catch(err=>{console.error(err);process.exitCode=1});
