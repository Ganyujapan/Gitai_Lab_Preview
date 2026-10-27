/* Explicit-click Safari localStorage retry experiment. Synthetic warning
 * life, sandbox-only DB and sandbox-only localStorage key. NOT an actual v2
 * restoration or a guarantee of cross-store atomicity.
 */
(function(root,factory){
  'use strict';const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.GitaiWarningLifeRehearsal=api;
})(typeof globalThis==='undefined'?this:globalThis,function(){
  'use strict';
  const GEN='gen00035';
  const NAME=/^gitai-backup-rehearsal-[a-f0-9]{32}$/;
  function openTestDb(idb,name){
    if(!NAME.test(name))throw Error('テスト用DB名以外は開けません。');
    return new Promise((resolve,reject)=>{
      const req=idb.open(name,3);
      req.onupgradeneeded=e=>{
        if(e.oldVersion!==0){req.transaction.abort();return;}
        for(const s of ['images','meta','theater_frames','backup_v2_stage'])
          req.result.createObjectStore(s);
      };
      req.onerror=()=>reject(req.error||Error('隔離DBが開けません。'));
      req.onblocked=()=>reject(Error('隔離DBが使用されています。'));
      req.onsuccess=()=>resolve(req.result);
    });
  }
  function seed(db,epoch){
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('meta','readwrite');
      tx.oncomplete=resolve;
      tx.onabort=()=>reject(tx.error||Error('隔離DB初期化失敗'));
      tx.onerror=()=>{};
      tx.objectStore('meta').put(GEN,'current_generation_id');
      tx.objectStore('meta').put(epoch,'restore_epoch');
    });
  }
  async function* dummyRecords(){
    for(let i=1;i<=60;i++)yield {
      store:'images',key:GEN+':'+String(i).padStart(2,'0'),
      value:new Blob(['synthetic-'+i],{type:'image/png'})
    };
    yield {store:'meta',key:'current_generation_id',value:GEN};
    for(let i=1;i<=60;i++)yield {
      store:'meta',key:'genome:'+GEN+':'+String(i).padStart(2,'0'),
      value:{synthetic:true,index:i}
    };
    yield {store:'theater_frames',key:'test:'+GEN,value:{synthetic:true}};
  }
  async function removeDb(idb,name){
    if(!NAME.test(name))throw Error('隔離DB以外の削除は禁止です。');
    await new Promise((resolve,reject)=>{
      const req=idb.deleteDatabase(name);
      req.onsuccess=resolve;
      req.onerror=()=>reject(req.error||Error('テストDBを削除できません。'));
      req.onblocked=()=>reject(Error('テストDBの削除がブロックされています。'));
    });
  }
  async function runRehearsal({
    indexedDb=globalThis.indexedDB,cryptoApi=globalThis.crypto,
    lifeStorage=globalThis.localStorage,
    backupApi=globalThis.GitaiBackupV2,
    recoveryApi=globalThis.GitaiWarningLifeRecoveryV2,
    schemaApi=globalThis.GitaiBackupSchemaRehearsal,
    onPhase=()=>{}
  }={}){
    if(!indexedDb||!cryptoApi||!lifeStorage||!backupApi||!recoveryApi||
       !schemaApi||typeof recoveryApi.makePendingLifePlan!=='function'||
       typeof recoveryApi.applyPendingLife!=='function')
      throw Error('隔離テストのモジュールが不足しています。');
    const name=schemaApi.uniqueSandboxName(cryptoApi);
    if(!NAME.test(name))throw Error('生成されたテストDB名が不正です。');
    const key=recoveryApi.KEY_PREFIX+name;
    const bytes=cryptoApi.getRandomValues(new Uint8Array(16));
    const epoch='restore-'+Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
    let db=null;
    try {
      onPhase('ライフ確認専用DBをv3で作成（実験DBは操作しません）');
      db=await openTestDb(indexedDb,name);
      await seed(db,epoch);
      const files=[];
      const life=JSON.stringify({generation_id:GEN,thirds:7});
      const {manifestFile}=await backupApi.writePartsFromRecords(dummyRecords(),{
        mode:'warning',database:name,currentGeneration:GEN,
        warningLife:life,maxPartBytes:4096,maxPartEntries:12
      },async file=>files.push(file));
      // This rehearsal exercises only warning-life follow-up; it does not
      // perform a real IDB restore. 'committed' is synthetic test metadata.
      const committed={status:'db-committed',generation:GEN,epoch,
        entries:122,lifeRestored:false};
      const partApi={validateManifest:backupApi.validateManifest,
        MAX_MANIFEST_BYTES:backupApi.MAX_MANIFEST_BYTES};
      const plan=await recoveryApi.makePendingLifePlan({
        db,committed,manifestFile,partApi
      });
      onPhase('保存失敗を模擬し、ライフ未完了と表示されることを確認');
      let refused=0;
      const failingStorage={
        getItem:k=>lifeStorage.getItem(k),
        setItem(){refused++;throw Error('Synthetic localStorage SecurityError');},
        removeItem:k=>lifeStorage.removeItem(k)
      };
      const partial=await recoveryApi.applyPendingLife({
        db,plan,storage:failingStorage
      });
      if(partial.status!=='life-pending'||partial.lifeRestored!==false||
         refused!==1)throw Error('ライフ保存の失敗を正しく報告できません。');
      onPhase('同じ復元epochを検証して、本物のlocalStorageへ再適用');
      const done=await recoveryApi.applyPendingLife({
        db,plan,storage:lifeStorage
      });
      if(done.status!=='life-complete'||done.lifeRestored!==true||
         lifeStorage.getItem(key)!==life)throw Error('ライフの再保存を確認できません。');
      onPhase('別の復元epochへ更新した場合は古いライフを拒否');
      const newer='restore-'+ 'f'.repeat(32);
      if(newer===epoch)throw Error('隔離テストのepochを生成できません。');
      await seed(db,newer);
      const stale=await recoveryApi.applyPendingLife({db,plan,storage:lifeStorage});
      if(stale.status!=='stale'||stale.lifeRestored!==false)
        throw Error('古いライフを拒否できません。');
      return {success:true,sandboxOnly:true,
        syntheticWarningLifeThirds:7,partialErrorDetected:true,
        retrySucceeded:true,staleEpochRejected:true,
        note:'実際の警告色復元や強制終了は検証していません。'};
    } finally {
      try{lifeStorage.removeItem(key);}catch(error){
        onPhase('テスト用ライフ値を削除できません：'+error.message);
      }
      try{db?.close();}catch(_) {}
      try{await removeDb(indexedDb,name);
        onPhase('テスト専用DBを削除しました。');
      }catch(error){onPhase('隔離DBの後片付けに失敗：'+error.message);}
    }
  }
  return Object.freeze({runRehearsal});
});
