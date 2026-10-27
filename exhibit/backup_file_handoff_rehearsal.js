/* RE2-EXH-02: manual Safari/iPad FILE handoff rehearsal for multipart v2.
 * Synthesizes only fabricated records; NO IndexedDB/localStorage/fetch.
 * This is NOT a real exhibition backup and cannot restore real game data.
 * Each download must be initiated by a separate human tap. Re-select ALL
 * saved files to verify bytes and SHA-256 before accepting the result.
 */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.GitaiBackupFileHandoffRehearsal=api;
})(typeof globalThis==='undefined'?this:globalThis,function(){
  'use strict';
  const MODE='cryptic';
  // Deliberately NOT a real mode DB. A real restore rejects this manifest.
  const DATABASE='gitai-synthetic-handoff-only-not-a-game-db';
  const GENERATION='gen00042';
  const MAX_FILES=10;
  const MAX_TOTAL_BYTES=1024*1024;
  let prepared=null;
  let busy=false;
  function fail(message){throw Error('分割ファイル保存テスト：'+message);}
  const index=i=>String(i).padStart(2,'0');

  async function* dummyRecords(){
    // These are FAKE images and genomes. They deliberately do not contain
    // real moth PNG data, so they can never be mistaken for a restorable run.
    for(let i=1;i<=60;i++)yield {
      store:'images',key:GENERATION+':'+index(i),
      value:new Blob(['SYNTHETIC_NOT_A_PNG_'+index(i)],{type:'application/octet-stream'})
    };
    yield {store:'meta',key:'current_generation_id',value:GENERATION};
    for(let i=1;i<=60;i++)yield {
      store:'meta',key:'genome:'+GENERATION+':'+index(i),
      value:{synthetic_only:true,id:i,alleles:[0,1]}
    };
    yield {store:'theater_frames',key:'synthetic-frame',value:{synthetic_only:true}};
  }

  function requireV2(api){
    if(!api||typeof api.writePartsFromRecords!=='function'||
       typeof api.verifyPartIntegrity!=='function')fail('分割バックアップ検証器がありません。');
    return api;
  }

  async function prepare(api){
    if(busy)fail('ほかの保存テストが実行中です。');
    busy=true;
    prepared=null;
    try{
      const v2=requireV2(api);
      const parts=[];
      const {manifestFile,manifest}=await v2.writePartsFromRecords(dummyRecords(),{
        mode:MODE,database:DATABASE,currentGeneration:GENERATION,
        // Force 5+ files without needing any user data or large allocations.
        maxPartEntries:32,maxPartBytes:32*1024,
        createdAt:'2026-10-28T00:00:00.000Z'
      },async(file)=>{
        parts.push(file);
        if(parts.length>MAX_FILES-1)fail('ファイル数の安全上限を超えています。');
      });
      const files=[...parts,manifestFile]; // Manifest is LAST.
      if(files.length<4||files.length>MAX_FILES||
         manifest.totals.entries!==122||
         manifest.parts.length!==parts.length||
         files.reduce((n,f)=>n+f.size,0)>MAX_TOTAL_BYTES) {
        fail('合成ファイルの件数または容量が想定外です。');
      }
      // Verify all generated parts before allowing downloads.
      const checked=await v2.verifyPartIntegrity(manifestFile,parts,MODE,DATABASE);
      if(checked.entries!==122||checked.generation!==GENERATION)
        fail('合成ファイルの初期検証に失敗しました。');
      prepared={
        manifestText:await manifestFile.text(),
        files:new Map(files.map(file=>[file.name,file])),
        names:files.map(file=>file.name),
        entries:checked.entries
      };
      return Object.freeze({
        files:Object.freeze(files.map(file=>Object.freeze({
          name:file.name,bytes:file.size
        }))),
        partFiles:parts.length,entries:checked.entries,
        totalBytes:files.reduce((n,f)=>n+f.size,0),
        syntheticOnly:true,
        requiresManualReselection:true
      });
    }catch(error){
      prepared=null;
      throw error;
    }finally{busy=false;}
  }

  function downloadFile(name){
    if(!prepared||!prepared.files.has(name))fail('先にテストデータを生成してください。');
    return prepared.files.get(name);
  }

  async function verifyReselected(files,api){
    const v2=requireV2(api);
    if(!prepared)fail('このページで合成ファイルを生成してください。');
    const selected=Array.from(files||[]);
    if(selected.length!==prepared.names.length||
       selected.length<4||selected.length>MAX_FILES) {
      fail('ファイルが不足、または余分なファイルがあります。'
        +' この画面で生成した全JSONファイルを選択してください。');
    }
    const names=new Set();
    const byName=new Map();
    for(const file of selected){
      if(!file||typeof file.name!=='string'||names.has(file.name)||
         !prepared.files.has(file.name)||!Number.isFinite(file.size)) {
        fail('ファイル名が不正、重複、またはテスト対象外です。');
      }
      names.add(file.name);byName.set(file.name,file);
    }
    const total=selected.reduce((n,f)=>n+f.size,0);
    if(total>MAX_TOTAL_BYTES)fail('テストファイルの合計容量を超えています。');
    const manifestFile=byName.get('manifest.json');
    if(!manifestFile||manifestFile.size>v2.MAX_MANIFEST_BYTES)
      fail('索引ファイルがありません。');
    // Prevent a valid but unrelated v2 manifest from being accepted merely
    // because its own embedded checksums are internally consistent.
    if(await manifestFile.text()!==prepared.manifestText)
      fail('保存した索引が、この画面で生成した内容と一致しません。');
    const parts=prepared.names.filter(name=>name!=='manifest.json')
      .map(name=>byName.get(name));
    const verified=await v2.verifyPartIntegrity(
      manifestFile,parts,MODE,DATABASE);
    if(verified.entries!==prepared.entries||verified.entries!==122||
       verified.generation!==GENERATION)fail('保存ファイルの再検証結果が一致しません。');
    return Object.freeze({
      success:true,syntheticOnly:true,
      checkedFiles:selected.length,checkedParts:parts.length,
      checkedEntries:verified.entries,
      independentlyReselected:true,
      // No inference about successful REAL backups or device quotas.
      actualGameDataVerified:false
    });
  }

  return Object.freeze({prepare,downloadFile,verifyReselected});
});
