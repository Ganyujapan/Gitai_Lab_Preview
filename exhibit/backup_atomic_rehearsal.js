/* Explicit-click real IndexedDB restore rehearsal for Safari/iPad.
 * Every database touched has a freshly randomized isolated sandbox name.
 * Does NOT import or connect to the exhibition game/admin databases.
 * Simulated abort is not a real quota or browser-crash test.
 */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.GitaiAtomicRestoreRehearsal=api;
})(typeof globalThis==='undefined'?this:globalThis,function(){
  'use strict';
  const OLD='gen00022', NEXT='gen00035';
  const LOCI=Object.freeze(['central_blotch','transverse_band','outer_edge',
    'speckle_cluster','longitudinal_streaks','cloud_mottle','ring_spots',
    'diagonal_streak','chevron_pair','twin_spots','ripple_bands','radial_rays']);
  function genome(i){
    return {schema_version:1,baseHue:i,baseSaturation:0.4,baseValue:0.5,
      patternContrast:0.5,textureStrength:0.5,textureSeed:i*123,
      modules:Object.fromEntries(LOCI.map(name=>[name,{alleles:[0,1]}]))};
  }
  function checkGenome(value,i) {
    if(!value||value.schema_version!==1||
       typeof value.baseHue!=='number'||value.baseHue!==i||
       !value.modules||Object.keys(value.modules).length!==LOCI.length||
       LOCI.some(x=>!Array.isArray(value.modules[x]?.alleles)||
         value.modules[x].alleles.join(',')!=='0,1')) {
      throw Error('テスト用DNAの内容が不正です：'+i);
    }
  }
  async function png128(){
    if(typeof document==='undefined')throw Error('画像生成にはブラウザが必要です。');
    const canvas=document.createElement('canvas');
    canvas.width=128;canvas.height=128;
    const context=canvas.getContext('2d');
    if(!context)throw Error('Canvasが利用できません。');
    context.fillStyle='#48704a';
    context.fillRect(0,0,128,128);
    context.fillStyle='#cd6c23';
    context.fillRect(30,30,60,60);
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(
      x=>x?resolve(x):reject(Error('PNG生成に失敗しました。')),'image/png'));
    if(blob.type!=='image/png')throw Error('PNG形式を作成できません。');
    return blob;
  }
  async function checkPng(blob,i){
    if(!(blob instanceof Blob)||blob.type!=='image/png'||
       blob.size<24||blob.size>2*1024*1024)throw Error('テスト用PNGの形式が不正：'+i);
    const header=new Uint8Array(await blob.slice(0,24).arrayBuffer());
    const sig=[137,80,78,71,13,10,26,10];
    if(sig.some((x,j)=>header[j]!==x))throw Error('PNGヘッダーが不正：'+i);
    const view=new DataView(header.buffer);
    if(view.getUint32(16)!==128||view.getUint32(20)!==128)
      throw Error('PNGサイズが不正：'+i);
    if(typeof createImageBitmap==='function'){
      const img=await createImageBitmap(blob);
      try{if(img.width!==128||img.height!==128)throw Error('PNG寸法が不正：'+i);}
      finally{img.close?.();}
    }else{
      const url=URL.createObjectURL(blob);
      try{
        await new Promise((resolve,reject)=>{
          const img=new Image();
          img.onload=()=>img.naturalWidth===128&&img.naturalHeight===128
            ?resolve():reject(Error('PNG寸法が不正：'+i));
          img.onerror=()=>reject(Error('PNGをデコードできません：'+i));
          img.src=url;
        });
      }finally{URL.revokeObjectURL(url);}
    }
  }
  function reqValue(req){
    return new Promise((resolve,reject)=>{
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||Error('IndexedDB request failed'));
    });
  }
  function done(tx){
    return new Promise((resolve,reject)=>{
      tx.oncomplete=resolve;
      tx.onabort=()=>reject(tx.error||Error('IndexedDB transaction aborted'));
      tx.onerror=()=>{};
    });
  }
  function openSandbox(idb,name,version,upgrade){
    if(!/^gitai-backup-rehearsal-[a-f0-9]{32}$/.test(name))
      return Promise.reject(Error('隔離用の名前ではありません。'));
    return new Promise((resolve,reject)=>{
      let error=null;
      const req=idb.open(name,version);
      req.onupgradeneeded=event=>{
        try{upgrade(req.result,event.oldVersion);}
        catch(e){error=e;try{req.transaction.abort();}catch(_){}}
      };
      req.onerror=()=>reject(error||req.error||Error('DB open failed'));
      req.onblocked=()=>reject(Error('隔離テストDBが別の画面で開かれています。'));
      req.onsuccess=()=>resolve(req.result);
    });
  }
  async function seedOld(idb,name){
    const db=await openSandbox(idb,name,2,(target,old)=>{
      if(old!==0)throw Error('新規テストDBでありません。');
      for(const store of ['images','meta','theater_frames'])
        target.createObjectStore(store);
    });
    try{
      const tx=db.transaction(['images','meta','theater_frames'],'readwrite');
      const finished=done(tx);
      tx.objectStore('images').put(new Blob(['legacy-png']),'legacy-image');
      tx.objectStore('meta').put(OLD,'current_generation_id');
      tx.objectStore('meta').put('restore-old-epoch','restore_epoch');
      tx.objectStore('meta').put({marker:'LEGACY'},'legacy-genome');
      tx.objectStore('theater_frames').put({marker:'LEGACY'},'legacy-frame');
      await finished;
    }finally{db.close();}
  }
  async function readState(db){
    const stores=['images','meta','theater_frames'];
    const tx=db.transaction(stores,'readonly');
    const finished=done(tx);
    const meta=tx.objectStore('meta'),images=tx.objectStore('images');
    const theater=tx.objectStore('theater_frames');
    const results=await Promise.all([
      reqValue(meta.get('current_generation_id')),
      reqValue(meta.get('restore_epoch')),
      reqValue(meta.get('legacy-genome')),
      reqValue(images.get('legacy-image')),
      reqValue(theater.get('legacy-frame')),
      reqValue(images.count()),reqValue(meta.count()),reqValue(theater.count()),
      reqValue(images.get(NEXT+':01')),
      reqValue(meta.get('genome:'+NEXT+':01'))
    ]);
    await finished;
    return {
      generation:results[0],epoch:results[1],
      legacyGenome:results[2]?.marker||null,
      legacyImage:results[3] instanceof Blob ? await results[3].text() : null,
      legacyFrame:results[4]?.marker||null,
      counts:results.slice(5,8),
      hasNewImage:results[8] instanceof Blob,
      hasNewGenome:results[9]?.schema_version===1
    };
  }
  function assertOld(state){
    if(state.generation!==OLD||state.epoch!=='restore-old-epoch'||
       state.legacyGenome!=='LEGACY'||state.legacyImage!=='legacy-png'||
       state.legacyFrame!=='LEGACY'||state.counts.join(',')!=='1,3,1'||
       state.hasNewImage||state.hasNewGenome) {
      throw Error('隔離DB内の旧世代が保持されていません：'+JSON.stringify(state));
    }
  }
  async function* newRecords(png){
    for(let i=1;i<=60;i++){
      yield {store:'images',key:NEXT+':'+String(i).padStart(2,'0'),value:png};
    }
    yield {store:'meta',key:'current_generation_id',value:NEXT};
    for(let i=1;i<=60;i++){
      yield {store:'meta',key:'genome:'+NEXT+':'+String(i).padStart(2,'0'),
        value:genome(i)};
    }
    yield {store:'theater_frames',key:'theater:'+NEXT,value:{tag:'NEW'}};
  }
  async function removeSandbox(idb,name,onPhase){
    if(!/^gitai-backup-rehearsal-[a-f0-9]{32}$/.test(name))
      throw Error('削除対象が隔離DBではありません。');
    await new Promise((resolve,reject)=>{
      const req=idb.deleteDatabase(name);
      req.onsuccess=resolve;
      req.onerror=()=>reject(req.error||Error('隔離DB削除に失敗しました'));
      req.onblocked=()=>reject(Error('隔離DB削除がブロックされました'));
    });
    onPhase('隔離テスト用DBを削除しました。');
  }

  async function runRehearsal({
    indexedDb=globalThis.indexedDB,cryptoApi=globalThis.crypto,
    onPhase=()=>{},
    backupApi=globalThis.GitaiBackupV2,
    semanticApi=globalThis.GitaiBackupRestorePreflightV2,
    restoreApi=globalThis.GitaiBackupAtomicRestoreV2,
    schemaApi=globalThis.GitaiBackupSchemaRehearsal
  }={}){
    if(!indexedDb||!cryptoApi||!backupApi||!semanticApi||!restoreApi||!schemaApi||
       typeof backupApi.writePartsFromRecords!=='function'||
       typeof restoreApi.stageValidatedBackup!=='function'||
       typeof restoreApi.commitStagedRestore!=='function'||
       typeof schemaApi.uniqueSandboxName!=='function') {
      throw Error('隔離試験モジュールの読込に失敗しました。');
    }
    const name=schemaApi.uniqueSandboxName(cryptoApi);
    let db=null;
    try{
      onPhase('新規の隔離DB v2に旧世代データを書き込み');
      await seedOld(indexedDb,name);
      onPhase('旧世代を残してv3に上げ、一時保存専用ストアだけ追加');
      db=await openSandbox(indexedDb,name,3,(target,oldVersion)=>{
        schemaApi.stageUpgradeOnly(target,oldVersion);
      });
      const original=await readState(db);
      assertOld(original);
      onPhase('Canvasで128×128 PNGと60匹分のDNAを生成');
      const png=await png128();
      await checkPng(png,1);
      const files=[];
      const {manifestFile}=await backupApi.writePartsFromRecords(
        newRecords(png),{mode:'cryptic',database:name,currentGeneration:NEXT,
          maxPartBytes:8192,maxPartEntries:12},
        async file=>files.push(file));
      if(files.length<2)throw Error('分割ファイルが足りません。');
      onPhase(files.length+'個の分割ファイルを内容検証して一時ストアに展開');
      const partApi={...backupApi};
      const stageId=restoreApi.makeStageId(cryptoApi);
      const prepared=await restoreApi.stageValidatedBackup({
        db,stageId,manifestFile,partFiles:files,mode:'cryptic',database:name,
        partApi,semanticApi,checkGenome,checkMothPng:checkPng,batchSize:8
      });
      if(prepared.entries!==122||prepared.generation!==NEXT)
        throw Error('一時保存した件数が違います。');
      assertOld(await readState(db));
      onPhase('一括復元中の15件目で意図的にabortして旧データの保持を確認');
      let injected=false;
      try {
        await restoreApi.commitStagedRestore(db,prepared,{
          cryptoApi,simulateAbortAfterRecords:15
        });
      }catch(error){
        if(error?.message==='Isolated simulated transaction abort')
          injected=true;
        else throw error;
      }
      if(!injected)throw Error('意図した中断を確認できませんでした。');
      assertOld(await readState(db));
      onPhase('同じ検証済みデータを使い、正常な原子的復元を実行');
      const commit=await restoreApi.commitStagedRestore(db,prepared,{cryptoApi});
      if(commit.status!=='db-committed'||commit.lifeRestored!==false||
         commit.generation!==NEXT||commit.entries!==122)
        throw Error('復元の確定結果が不正です。');
      const final=await readState(db);
      if(final.generation!==NEXT||final.legacyGenome||final.legacyImage||
         final.legacyFrame||final.counts.join(',')!=='60,62,1'||
         !final.hasNewImage||!final.hasNewGenome||
         !/^restore-[a-f0-9]{32}$/.test(final.epoch)||
         final.epoch===original.epoch)
        throw Error('復元後のデータが一致しません：'+JSON.stringify(final));
      onPhase('新しい世代と復元epochを確認しました。ライフは変更していません。');
      return {success:true,sandbox:true,oldGeneration:OLD,newGeneration:NEXT,
        checkedEntries:122,partFiles:files.length,
        forcedAbortPreservedOriginals:true,normalRestore:true,
        lifeRestored:false,syntheticDataOnly:true};
    }finally{
      db?.close();
      try{await removeSandbox(indexedDb,name,onPhase);}
      catch(error){onPhase('テストDBの後片付けに失敗：'+error.message);}
    }
  }
  return Object.freeze({OLD,NEXT,LOCI,genome,checkGenome,
    runRehearsal});
});
