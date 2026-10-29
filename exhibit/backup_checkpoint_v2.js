/* Experimental checkpoint for split exhibit backups.
 * NOT loaded by exhibit pages; requires a PRE-EXISTING isolated backup_stage
 * object store. No database version migration or current user data changes.
 * A schema migration, iPad quota testing and restore review are prerequisites
 * before wiring this into production.
 */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  else root.GitaiBackupCheckpointV2=api;
})(typeof globalThis==='undefined'?this:globalThis,function(){
  'use strict';
  const SOURCE_STORES=Object.freeze(['images','meta','theater_frames']);
  const STAGE_STORE='backup_v2_stage';
  const ID_RE=/^[a-z0-9][a-z0-9-]{7,63}$/;
  const GEN_RE=/^gen(?:\d{5}|[1-9]\d{5,})$/;
  const validId=id=>typeof id==='string' && ID_RE.test(id);
  const validKey=key=>typeof key==='string' ||
    (typeof key==='number' && Number.isFinite(key));
  const TOKEN_RE=/^[0-9a-f]{32}$/;
  const failure=text=>new Error('分割バックアップ一時保存：'+text);
  const rangeFor=id=>IDBKeyRange.bound([id],[id,'\uffff']);
  const checkPrerequisites=(db,id)=>{
    if(!db || !validId(id)) throw failure('識別子が不正です。');
    for(const name of [...SOURCE_STORES,STAGE_STORE]) {
      if(!db.objectStoreNames?.contains(name)) {
        throw failure('一時保存用ストアが未準備です。既存DBは変更しません。');
      }
    }
  };

  // A checkpoint ID can be reused after a legitimate cleanup. Give every
  // committed snapshot a cryptographically random identity so a reader that
  // spans short transactions cannot accidentally splice together two
  // different snapshots with the same ID and row count. This never uses
  // Math.random or the game's evolution RNG.
  function newSnapshotToken() {
    const random=globalThis.crypto;
    if(!random||typeof random.getRandomValues!=='function')
      throw failure('安全な一時保存識別子を生成できません。');
    const bytes=random.getRandomValues(new Uint8Array(16));
    return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  }

  // Copy each of the 3 original stores into the dedicated staging store
  // in ONE IndexedDB readwrite transaction. This serializes with writes by
  // game/restore transactions and gives a single committed source epoch.
  // DO NOT await (including Blob.arrayBuffer) inside this transaction.
  function makeCheckpoint(db, snapshotId) {
    checkPrerequisites(db,snapshotId);
    const checkpointToken=newSnapshotToken();
    return new Promise((resolve,reject)=>{
      let tx;
      let error=null, generation=null, copied=0;
      const counts={images:0,meta:0,theater_frames:0};
      function abort(reason) {
        if(error)return;
        error=reason instanceof Error?reason:failure(String(reason));
        try {tx.abort();} catch(_) {}
      }
      try {
        tx=db.transaction([...SOURCE_STORES,STAGE_STORE],'readwrite');
        tx.oncomplete=()=>{
          if(error)reject(error);
          else resolve({snapshotId,checkpointToken,generation,entries:copied,byStore:counts});
        };
        tx.onabort=()=>reject(error||tx.error||failure('コピーが中断されました。'));
        tx.onerror=()=>{if(!error)error=tx.error||failure('コピーに失敗しました。');};
        const stage=tx.objectStore(STAGE_STORE);
        const exists=stage.count(rangeFor(snapshotId));
        exists.onerror=()=>abort(exists.error||failure('一時保存の識別子を確認できません。'));
        exists.onsuccess=()=>{
          if(exists.result!==0) {
            abort(failure('同じ識別子の一時保存が存在します。上書きしません。'));
            return;
          }
          const pointer=tx.objectStore('meta').get('current_generation_id');
          pointer.onerror=()=>abort(pointer.error||failure('世代情報を確認できません。'));
          pointer.onsuccess=()=>{
            if(!GEN_RE.test(String(pointer.result))) {
              abort(failure('有効な世代番号がありません。'));
              return;
            }
            generation=pointer.result;
            try {
              for(const storeName of SOURCE_STORES) {
                const request=tx.objectStore(storeName).openCursor();
                request.onerror=()=>abort(request.error||failure('カーソルでの読込みに失敗しました。'));
                request.onsuccess=()=>{
                  if(error)return;
                  const cursor=request.result;
                  if(!cursor)return;
                  try {
                    if(!validKey(cursor.key)) throw failure('未対応の保存キーがあります。');
                    stage.put({store:storeName,key:cursor.key,value:cursor.value,
                      checkpointToken},[snapshotId,storeName,cursor.key]);
                    counts[storeName]++;
                    copied++;
                    cursor.continue();
                  } catch(e) {abort(e);}
                };
              }
            }catch(e){abort(e);}
          };
        };
      }catch(e) {
        if(tx) {
          error=e;
          try {tx.abort();} catch(_) {reject(e);}
        } else reject(e);
      }
    });
  }

  // Read only the precommitted immutable staging store in small, independent
  // transactions. It is safe to await Blob conversion BETWEEN these reads.
  // expectedEntries and checkpointToken MUST come from makeCheckpoint. A
  // concurrent discard/recreate of the same snapshotId must not merge rows
  // from different snapshots, even if both have identical row counts.
  async function* readCheckpoint(db,snapshotId,expectedEntries,
    {batchSize=8,signal=null,checkpointToken=null}={}) {
    checkPrerequisites(db,snapshotId);
    if(!Number.isSafeInteger(expectedEntries)||expectedEntries<=0 ||
       !Number.isSafeInteger(batchSize)||batchSize<1||batchSize>64) {
      throw failure('読込み件数またはバッチサイズが不正です。');
    }
    if(!TOKEN_RE.test(checkpointToken||''))
      throw failure('一時保存識別子がありません。再取得が必要です。');
    if(signal!==null && typeof signal.aborted!=='boolean')
      throw failure('中断通知が不正です。');
    const checkCancelled=()=>{
      if(signal?.aborted) throw failure('読込みが中断されました。');
    };
    checkCancelled();
    const upper=[snapshotId,'\uffff'];
    let previous=null,finished=false,seen=0;
    while(!finished) {
      checkCancelled();
      const batch=await new Promise((resolve,reject)=>{
        const collected=[];
        let tx,done=false,error=null,last=null;
        try {
          tx=db.transaction(STAGE_STORE,'readonly');
          tx.oncomplete=()=>resolve({collected,done,last});
          tx.onabort=()=>reject(error||tx.error||failure('一時保存の読込みが中断されました。'));
          tx.onerror=()=>{if(!error)error=tx.error||failure('一時保存の読込みに失敗しました。');};
          const range=previous===null?
            rangeFor(snapshotId):IDBKeyRange.bound(previous,upper,true,false);
          const req=tx.objectStore(STAGE_STORE).openCursor(range);
          req.onerror=()=>{error=req.error||failure('カーソルを開けません。');try{tx.abort();}catch(_){}};
          req.onsuccess=()=>{
            const cursor=req.result;
            if(!cursor){done=true;return;}
            const key=cursor.key,value=cursor.value;
            if(!Array.isArray(key)||key.length!==3||key[0]!==snapshotId||
                !SOURCE_STORES.includes(key[1])||key[1]!==value?.store||
                key[2]!==value?.key||!validKey(value.key)) {
              error=failure('一時保存内のキーが破損しています。');
              try{tx.abort();}catch(_){}
              return;
            }
            if(value.checkpointToken!==checkpointToken) {
              error=failure('一時保存が別のスナップショットに切り替わりました。');
              try{tx.abort();}catch(_){}
              return;
            }
            collected.push({store:value.store,key:value.key,value:value.value});
            last=key;
            if(collected.length<batchSize) cursor.continue();
          };
        }catch(e){if(tx){try{tx.abort();}catch(_){reject(e);}}else reject(e);}
      });
      checkCancelled();
      for(const record of batch.collected) {
        checkCancelled();
        seen++;
        if(seen>expectedEntries) throw failure('一時保存の項目数が多すぎます。');
        yield record;
      }
      if(batch.done||!batch.collected.length) finished=true;
      else previous=batch.last;
    }
    checkCancelled();
    if(seen!==expectedEntries) throw failure('一時保存の項目数が不足しています。');
    // The reader has already consumed all rows. Another tab may have
    // deleted earlier rows between batches: that would not change 'seen'.
    // Check the full staging count one last time before allowing a manifest.
    const finalCount=await new Promise((resolve,reject)=>{
      let tx,req;
      try {
        tx=db.transaction(STAGE_STORE,'readonly');
        tx.oncomplete=()=>resolve(req.result);
        tx.onabort=()=>reject(tx.error||failure('最終件数の検証が中断されました。'));
        tx.onerror=()=>{};
        req=tx.objectStore(STAGE_STORE).count(rangeFor(snapshotId));
      } catch(error) {reject(error);}
    });
    checkCancelled();
    if(finalCount!==expectedEntries) {
      throw failure('一時保存の件数が読込み中に変更されました。');
    }
  }

  // Deletes only the selected temporary checkpoint ID, NEVER sources.
  // Call only after durable output or explicit cancellation. Cleanup errors
  // may leave temporary copies consuming quota, but never erase evolution.
  function discardCheckpoint(db,snapshotId) {
    checkPrerequisites(db,snapshotId);
    return new Promise((resolve,reject)=>{
      let tx,removed=0,error=null;
      try {
        tx=db.transaction(STAGE_STORE,'readwrite');
        tx.oncomplete=()=>resolve(removed);
        tx.onabort=()=>reject(error||tx.error||failure('一時保存の後片付けが中断されました。'));
        tx.onerror=()=>{if(!error)error=tx.error||failure('一時保存の後片付けに失敗しました。');};
        const req=tx.objectStore(STAGE_STORE).openCursor(rangeFor(snapshotId));
        req.onerror=()=>{error=req.error||failure('一時保存を列挙できません。');try{tx.abort();}catch(_){}};
        req.onsuccess=()=>{
          const cursor=req.result;
          if(!cursor)return;
          try {
            cursor.delete();
            removed++;
            cursor.continue();
          } catch(e) {error=e;try{tx.abort();}catch(_){}}
        };
      }catch(e){if(tx){try{tx.abort();}catch(_){reject(e);}}else reject(e);}
    });
  }

  return Object.freeze({SOURCE_STORES,STAGE_STORE,makeCheckpoint,
    readCheckpoint,discardCheckpoint});
});
