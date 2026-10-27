/* EXPERIMENTAL RE2-EXH-02: isolated warning-life follow-up after an
 * IndexedDB v2 multipart restore. NEVER imported by game or admin UI.
 * IndexedDB and localStorage CANNOT commit atomically together.
 * This module cannot write to any real exhibit life key or real game DB.
 * Only a fresh gitai-backup-rehearsal-<32 lowercase hex> v3 sandbox is valid.
 */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.GitaiWarningLifeRecoveryV2=api;
})(typeof globalThis==='undefined'?this:globalThis,function(){
  'use strict';
  const SANDBOX=/^gitai-backup-rehearsal-[0-9a-f]{32}$/;
  const EPOCH=/^restore-[0-9a-f]{32}$/;
  const GEN=/^gen(?:\d{5}|[1-9]\d{5,})$/;
  const KEY_PREFIX='gitai-warning-life-sandbox-v2:';
  const privatePlans=new WeakSet();
  const fail=why=>{throw Error('警告色ライフの隔離復元：'+why);};
  function checkedDatabase(db){
    if(!db||!SANDBOX.test(db.name||'')||db.version!==3||
       !db.objectStoreNames?.contains('meta')||
       !db.objectStoreNames?.contains('backup_v2_stage')) {
      fail('本物の実験DBには接続できません。隔離DB v3が必要です。');
    }
  }
  function lifeValue(value,generation){
    if(value===null)return null;
    if(typeof value!=='string'||value.length>1024)fail('ライフの形式が不正です。');
    let life;
    try{life=JSON.parse(value);}catch(_){fail('ライフJSONが不正です。');}
    if(!life||typeof life!=='object'||Array.isArray(life)||
       life.generation_id!==generation||
       !Number.isInteger(life.thirds)||life.thirds<1||life.thirds>30) {
      fail('ライフの世代番号・残量が不正です。');
    }
    return value;
  }
  function readDbEpoch(db) {
    checkedDatabase(db);
    return new Promise((resolve,reject)=>{
      let tx;
      try{
        tx=db.transaction('meta','readonly');
        let generation,epoch;
        const pointer=tx.objectStore('meta').get('current_generation_id');
        const restore=tx.objectStore('meta').get('restore_epoch');
        pointer.onsuccess=()=>{generation=pointer.result;};
        restore.onsuccess=()=>{epoch=restore.result;};
        tx.oncomplete=()=>resolve({generation,epoch});
        tx.onabort=()=>reject(tx.error||Error('ライフ世代読出しが中断されました。'));
        tx.onerror=()=>{};
      }catch(error){reject(error);}
    });
  }
  // Accept only a completed, successful sandbox DB commit. The manifest must
  // be for warning mode and match both DB name and committed generation/count.
  // Reading manifest/DB is read-only; no life value is written yet.
  async function makePendingLifePlan({db,committed,manifestFile,partApi}){
    checkedDatabase(db);
    if(!partApi||typeof partApi.validateManifest!=='function'||
       !manifestFile||!Number.isFinite(manifestFile.size)||
       manifestFile.size<1||manifestFile.size>partApi.MAX_MANIFEST_BYTES) {
      fail('索引ファイルまたは検査器が不正です。');
    }
    if(!committed||!['db-committed','db-committed-cleanup-warning'].includes(committed.status)||
       committed.lifeRestored!==false||committed.generation==null||
       !GEN.test(committed.generation)||!EPOCH.test(committed.epoch)||
       !Number.isSafeInteger(committed.entries)||committed.entries<121) {
      fail('IndexedDBの確定が確認できません。');
    }
    let manifest;
    try{manifest=JSON.parse(await manifestFile.text());}
    catch(_){fail('索引JSONを読めません。');}
    partApi.validateManifest(manifest,'warning',db.name);
    if(manifest.currentGeneration!==committed.generation||
       manifest.totals.entries!==committed.entries) {
      fail('確定した世代・件数と索引が一致しません。');
    }
    const life=lifeValue(manifest.warningLife??null,committed.generation);
    const {generation,epoch}=await readDbEpoch(db);
    if(generation!==committed.generation||epoch!==committed.epoch)
      fail('確定後に世代または復元履歴が更新されました。');
    const plan=Object.freeze({
      status:'life-pending',database:db.name,generation,epoch,
      warningLife:life,storageKey:KEY_PREFIX+db.name
    });
    privatePlans.add(plan);
    return plan;
  }

  // localStorage errors are reported as PARTIAL DB restores; NEVER pretend
  // they roll back IndexedDB. The epoch check prevents reapplying old life
  // after an intervening restore. Between the epoch read and the storage write
  // another tab can progress: the caller must close all other game tabs.
  async function applyPendingLife({db,plan,storage}){
    checkedDatabase(db);
    if(!plan||!privatePlans.has(plan)||plan.database!==db.name||
       !EPOCH.test(plan.epoch)||!GEN.test(plan.generation)||
       plan.storageKey!==KEY_PREFIX+db.name) {
      fail('検証済みのライフ復元計画がありません。');
    }
    if(!storage||typeof storage.getItem!=='function'||
       typeof storage.setItem!=='function'||
       typeof storage.removeItem!=='function') {
      fail('ライフ用ストレージを利用できません。');
    }
    const before=await readDbEpoch(db);
    if(before.generation!==plan.generation||before.epoch!==plan.epoch) {
      return Object.freeze({
        status:'stale',lifeRestored:false,database:db.name,
        detail:'新しい世代・復元を検出したため、古いライフを適用しません。'
      });
    }
    let storageError=null;
    try {
      if(plan.warningLife===null)storage.removeItem(plan.storageKey);
      else storage.setItem(plan.storageKey,plan.warningLife);
      if(storage.getItem(plan.storageKey)!==plan.warningLife) {
        throw Error('ライフを保存した後の読出し結果が一致しません。');
      }
    }catch(error){storageError=error;}
    // A second check does not make the two persistence mechanisms atomic.
    // It detects interleaving after the write when possible and FAILS CLOSED.
    const after=await readDbEpoch(db);
    if(after.generation!==plan.generation||after.epoch!==plan.epoch) {
      try {
        if(storage.getItem(plan.storageKey)===plan.warningLife)
          storage.removeItem(plan.storageKey);
      }catch(_) {}
      return Object.freeze({
        status:'stale',lifeRestored:false,database:db.name,
        detail:'ライフの適用中に世代または復元履歴が更新されました。'
      });
    }
    if(storageError)return Object.freeze({
      status:'life-pending',lifeRestored:false,database:db.name,
      generation:plan.generation,epoch:plan.epoch,
      detail:storageError?.message||String(storageError)
    });
    return Object.freeze({
      status:'life-complete',lifeRestored:true,database:db.name,
      generation:plan.generation,epoch:plan.epoch
    });
  }

  return Object.freeze({KEY_PREFIX,makePendingLifePlan,applyPendingLife});
});
