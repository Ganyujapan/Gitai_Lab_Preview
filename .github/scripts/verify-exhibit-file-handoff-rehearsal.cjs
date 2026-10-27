'use strict';
// RE2-EXH-02: exercise the REAL synthetic v2 File handoff code; no device
// IndexedDB, normal life key, navigation or network is ever accessed.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
if(!globalThis.crypto)globalThis.crypto=webcrypto;
if(!globalThis.File){
  globalThis.File=class extends Blob{
    constructor(chunks,name,opts){super(chunks,opts);this.name=name;}
  };
}
let dbTouches=0,lifeTouches=0,requests=0;
globalThis.indexedDB={open(){dbTouches++;throw Error('Synthetic handoff cannot open DB')}};
globalThis.localStorage={getItem(){lifeTouches++;throw Error('Cannot inspect life')}};
globalThis.fetch=()=>{requests++;throw Error('No network required')};
const v2=require('../../exhibit/backup_v2.js');
const handoff=require('../../exhibit/backup_file_handoff_rehearsal.js');
const moduleText=fs.readFileSync('exhibit/backup_file_handoff_rehearsal.js','utf8');
const html=fs.readFileSync('exhibit/backup_rehearsal.html','utf8');
const build=fs.readFileSync('exhibit/build.py','utf8');
new vm.Script(moduleText,{filename:'exhibit/backup_file_handoff_rehearsal.js'});
const inline=html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(inline);
new vm.Script(inline[1],{filename:'exhibit/backup_rehearsal.html'});
assert.doesNotMatch(moduleText,/indexedDB\.open|localStorage\.|fetch\(/);
const copy=async file=>new File([await file.arrayBuffer()],file.name,{type:file.type});
const rejected=(p,pattern)=>assert.rejects(p,pattern);
(async()=>{
  await rejected(handoff.verifyReselected([],v2),/このページで合成ファイルを生成/);
  assert.throws(()=>handoff.downloadFile('manifest.json'),/先にテストデータを生成/);
  const summary=await handoff.prepare(v2);
  assert.equal(summary.syntheticOnly,true);
  assert.equal(summary.requiresManualReselection,true);
  assert.equal(summary.entries,122);
  assert.equal(summary.files.length,6,'five parts + one manifest');
  assert.equal(summary.partFiles,5);
  assert.ok(summary.totalBytes>0&&summary.totalBytes<1024*1024);
  assert.equal(summary.files.at(-1).name,'manifest.json',
    'manifest must be saved last, after all parts');
  assert.deepEqual(summary.files.slice(0,-1).map(x=>x.name),
    Array.from({length:5},(_,i)=>'part-'+String(i).padStart(5,'0')+'.json'));
  assert.ok(summary.files.every(x=>x.bytes>0&&x.bytes<32*1024));
  assert.ok(Object.isFrozen(summary)&&Object.isFrozen(summary.files));
  assert.ok(Object.isFrozen(summary.files[0]));
  const originals=summary.files.map(info=>handoff.downloadFile(info.name));
  assert.ok(originals.every(file=>file instanceof Blob));
  assert.throws(()=>handoff.downloadFile('other.json'),/先にテストデータを生成/);

  const selected=[];
  for(const file of originals)selected.push(await copy(file));
  const success=await handoff.verifyReselected(
    selected.slice().reverse(),v2);
  assert.equal(success.success,true);
  assert.equal(success.checkedFiles,6);
  assert.equal(success.checkedParts,5);
  assert.equal(success.checkedEntries,122);
  assert.equal(success.syntheticOnly,true);
  assert.equal(success.independentlyReselected,true);
  assert.equal(success.actualGameDataVerified,false);
  assert.equal(dbTouches,0);assert.equal(lifeTouches,0);assert.equal(requests,0);

  await rejected(handoff.verifyReselected(selected.slice(1),v2),
    /不足、または余分/);
  await rejected(handoff.verifyReselected([...selected,selected[1]],v2),
    /不足、または余分/);
  await rejected(handoff.verifyReselected(
    [selected[0],selected[0],...selected.slice(2)],v2),
    /重複|不正/);
  const wrongNamed=await copy(selected[0]);
  Object.defineProperty(wrongNamed,'name',{value:'manifest (1).json'});
  await rejected(handoff.verifyReselected(
    [wrongNamed,...selected.slice(1)],v2),/不正|重複/);

  const damagedBytes=new Uint8Array(await selected[0].arrayBuffer());
  damagedBytes[damagedBytes.length-4]^=1;
  const badPart=new File([damagedBytes],selected[0].name,
    {type:'application/json'});
  await rejected(handoff.verifyReselected(
    [badPart,...selected.slice(1)],v2),/破損|検証失敗/);
  const badManifest=new File(['{}'], 'manifest.json',
    {type:'application/json'});
  await rejected(handoff.verifyReselected(
    [...selected.slice(0,-1),badManifest],v2),/索引が.*一致/);
  const tooLarge=new File([new Uint8Array(1024*1024+1)],
    selected[1].name,{type:'application/json'});
  await rejected(handoff.verifyReselected(
    [selected[0],tooLarge,...selected.slice(2)],v2),/容量/);
  // Preparation is deterministic synthetic data, never a real game DB.
  const manifest=JSON.parse(await originals.at(-1).text());
  assert.equal(manifest.database,'gitai-synthetic-handoff-only-not-a-game-db');
  assert.equal(manifest.mode,'cryptic');
  assert.equal(manifest.currentGeneration,'gen00042');
  assert.equal(manifest.totals.entries,122);
  const firstPart=JSON.parse(await originals[0].text());
  assert.equal(firstPart.entries[0].value.$type,'Blob');
  assert.equal(firstPart.entries[0].value.mime,'application/octet-stream');
  const second=await handoff.prepare(v2);
  assert.equal(second.files.length,6);
  assert.equal(dbTouches,0);assert.equal(lifeTouches,0);assert.equal(requests,0);

  for(const id of [
    'handoffPrepare','handoffState','handoffDownloadButtons',
    'handoffFiles','handoffLog'
  ])assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/id="handoffFiles"[^>]*multiple disabled/);
  assert.match(html,/GitaiBackupFileHandoffRehearsal\.prepare\(GitaiBackupV2\)/);
  assert.match(html,/GitaiBackupFileHandoffRehearsal\.downloadFile\(info\.name\)/);
  assert.match(html,/GitaiBackupFileHandoffRehearsal\.verifyReselected\(/);
  assert.match(html,/handoffPrepare\.addEventListener\('click'/);
  assert.match(html,/button\.addEventListener\('click'/);
  assert.match(html,/handoffFiles\.addEventListener\('change'/);
  assert.match(html,/URL\.createObjectURL\(file\)/);
  assert.match(html,/a\.download=info\.name/);
  assert.match(html,/合成データのみ/);
  assert.match(html,/保存成功を保証しません/);
  assert.match(html,/本番の蛾・ライフ・進化データの復元を検証したものではありません/);
  assert.doesNotMatch(html,/\bfetch\(/);
  assert.match(build,/"backup_file_handoff_rehearsal\.js"/);
  assert.match(build,/assert "backup_file_handoff_rehearsal\.js" not in page_source/);
  assert.match(build,/assert "backup_file_handoff_rehearsal\.js" not in \(exhibit \/ "admin\.js"\)/);
  for(const path of [
    'exhibit/index.html','exhibit/modes.html','exhibit/admin.js',
    'exhibit/game.js','exhibit/landing.js'
  ]){
    assert.doesNotMatch(fs.readFileSync(path,'utf8'),
      /backup_file_handoff_rehearsal/,'Never auto-load in production: '+path);
  }
  console.log('RE2-EXH-02: synthetic 6-File v2 handoff, independent file re-read with SHA256/122 records, corruption/missing/duplicate/foreign manifest/size denial, opt-in click-only Safari UI, no live DB/life/network.');
})().catch(e=>{console.error(e);process.exitCode=1});
