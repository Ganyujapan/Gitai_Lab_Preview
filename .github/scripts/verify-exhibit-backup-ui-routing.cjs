'use strict';
// EXH-V1-UI: verify which actual file picker each admin button opens.
// Uses the shipped handlers and synthetic DOM/files; never touches game DB.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync('exhibit/admin.js','utf8');
const html=fs.readFileSync('exhibit/modes.html','utf8');
const start=src.indexOf("  const verifyBackupInput=document.getElementById('exhibitBackupVerifyFile');");
const end=src.indexOf("  document.getElementById('exhibitBackupRestore').addEventListener(",start);
assert.ok(start>0&&end>start,'Could not isolate production verifier button handlers');
const section=src.slice(start,end);
const normalHtml=html.match(/<input[^>]*id="exhibitBackupVerifyFile"[^>]*>/)?.[0];
const splitHtml=html.match(/<input[^>]*id="exhibitBackupV2Files"[^>]*>/)?.[0];
assert.ok(normalHtml&&splitHtml,'Both actual file-picker inputs must exist');
assert.doesNotMatch(normalHtml,/\bmultiple\b/,'Ordinary saved JSON must select ONE file');
assert.match(splitHtml,/\bmultiple\b/,'Experimental multipart must select multiple files');
assert.match(html,/<details id="exhibitBackupV2Details">/);
assert.match(html, /id="exhibitBackupVerifyResult"/);
assert.match(html, /id="exhibitBackupV2Result"/);
assert.ok(html.indexOf('id="exhibitBackupVerifyResult"') <
  html.indexOf('id="exhibitBackupV2Details"'), 'normal result must precede experimental UI');
assert.match(section,/verifyBackupInput\.click\(\)/);
assert.match(section,/v2FilesInput\.click\(\)/);
assert.doesNotMatch(section,/\brestoreMode\(/);

function setup() {
  const events=new Map(), clicks=[], checks=[];
  function element(id) {
    const obj={id,hidden:true,disabled:false,value:'',files:[],textContent:'',
      scrollIntoView(){},
      addEventListener(type,fn){events.set(id+':'+type,fn)},
      click(){
        // Count the file inputs opened, not the button the human pressed.
        if(id==='exhibitBackupVerifyFile'||id==='exhibitBackupV2Files')
          clicks.push(id);
        return events.get(id+':click')?.();
      }
    };
    return obj;
  }
  const nodes=new Map([
    'exhibitBackupVerify','exhibitBackupVerifyFile',
    'exhibitBackupV2Verify','exhibitBackupV2Files',
    'exhibitBackupVerifyResult','exhibitBackupV2Result'
  ].map(id=>[id,element(id)]));
  const message={textContent:''};
  const document={
    getElementById(id){
      if(!nodes.has(id))throw Error('Unexpected DOM lookup '+id);
      return nodes.get(id);
    },
    querySelector(q){
      return nodes.get(q.slice(1));
    }
  };
  let unlocked=true,preparingBackup=false,restoreMutationBusy=false,preparationId=3;
  const selector={value:'cryptic'};
  const context={
    document,selector,message,unlocked,preparingBackup,restoreMutationBusy,
    preparationId,MODES:{cryptic:{label:'隠れるギタイ'},warning:{label:'目立つギタイ'}},
    say(text){message.textContent=text;},
    async verifySavedBackupFile(file,mode){
      checks.push({type:'normal',file,mode});
      if(file.invalid)throw Error('broken checksum');
      return {fileName:file.name,mode,generation:'gen00014',count:282};
    },
    async verifySavedMultipartFiles(files,mode){
      checks.push({type:'multipart',files,mode});
      throw Error('manifest.json と part-*.json が必要です');
    },
    Promise,Error,Object,String,Array,console
  };
  vm.runInNewContext(section,context,{filename:'exhibit/admin.js:EXH-V1-UI',timeout:4000});
  async function select(id,files){
    nodes.get(id).files=files;
    await events.get(id+':change')();
  }
  return {nodes,clicks,checks,message,selector,select};
}
(async()=>{
  const s=setup();
  // The normal button must NEVER launch the multi-select picker.
  s.nodes.get('exhibitBackupVerify').click();
  assert.deepEqual(s.clicks,['exhibitBackupVerifyFile']);
  assert.match(s.nodes.get('exhibitBackupVerifyResult').textContent,/通常JSON/);
  assert.equal(s.nodes.get('exhibitBackupV2Result').hidden,true);
  const saved={name:'gitailab_2026_cryptic_gen00014.json'};
  await s.select('exhibitBackupVerifyFile',[saved]);
  assert.equal(s.checks.length,1);
  assert.equal(s.checks[0].type,'normal');
  assert.strictEqual(s.checks[0].file,saved);
  assert.equal(s.checks[0].mode,'cryptic');
  assert.match(s.nodes.get('exhibitBackupVerifyResult').textContent,
    /保存済みJSONの検証成功/);
  assert.match(s.nodes.get('exhibitBackupVerifyResult').textContent,/gen00014/);
  assert.equal(s.nodes.get('exhibitBackupV2Result').hidden,true);

  // A corrupt JSON must report failure beside the same normal button.
  s.nodes.get('exhibitBackupVerify').click();
  await s.select('exhibitBackupVerifyFile',[{name:'broken.json',invalid:true}]);
  assert.match(s.nodes.get('exhibitBackupVerifyResult').textContent,
    /保存済みJSONの検証失敗.*broken checksum/);
  assert.equal(s.checks.at(-1).type,'normal');

  // The advanced experimental picker has its own route and own result.
  s.nodes.get('exhibitBackupV2Verify').click();
  assert.equal(s.clicks.at(-1),'exhibitBackupV2Files');
  assert.match(s.nodes.get('exhibitBackupV2Result').textContent,/試験用分割JSON/);
  await s.select('exhibitBackupV2Files',[
    {name:'manifest.json'}, {name:'part-00000.json'}
  ]);
  assert.equal(s.checks.at(-1).type,'multipart');
  assert.match(s.nodes.get('exhibitBackupV2Result').textContent,/分割ファイルの検証失敗/);
  assert.match(s.nodes.get('exhibitBackupVerifyResult').textContent,/保存済みJSONの検証失敗/,
    'experimental result must not overwrite normal JSON feedback');

  assert.deepEqual(s.clicks,[
    'exhibitBackupVerifyFile','exhibitBackupVerifyFile','exhibitBackupV2Files'
  ]);
  console.log('EXH-V1-UI: normal single JSON and optional multipart pickers, independent inline success/failure, no restoration or DB access PASS');
})().catch(err=>{console.error(err);process.exitCode=1});
