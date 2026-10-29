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
  // The recovery inspector cannot safely enumerate larger snapshots.
  // Refuse a snapshot above the same entry ceiling before allocating
  // uninspectable temporary state. The entire four-store transaction aborts.
  const MAX_CHECKPOINT_ENTRIES=250000;
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
  function makeCheckpoint(db, snapshotId,
    {maxEntries=MAX_CHECKPOINT_ENTRIES,signal=null}={}) {
    checkPrerequisites(db,snapshotId);
    if(!Number.isSafeInteger(maxEntries)||maxEntries<1||
       maxEntries>MAX_CHECKPOINT_ENTRIES) {
      throw failure('一時保存件数の上限指定が不正です。');
    }
    if(signal!==null && (typeof signal.aborted!=='boolean'||
        typeof signal.addEventListener!=='function'||
        typeof signal.removeEventListener!=='function')) {
      throw failure('中断通知の形式が不正です。');
    }
    if(signal?.aborted) {
      return Promise.reject(failure('一時保存の作成が中断されました。'));
    }
    const checkpointToken=newSnapshotToken();
    return new Promise((resolve,reject)=>{
      let tx;
      let error=null, generation=null, copied=0;
      const counts={images:0,meta:0,theater_frames:0};
      function removeAbortListener() {
        signal?.removeEventListener('abort',onAbort);
      }
      function onAbort() {
        // If commit already completed, IDB rejects abort(). In that case
        // report actual commit completion, not a false cancellation.
        if(error)return;
        try {
          tx.abort();
          error=failure('一時保存の作成が中断されました。');
        }catch(_) {}
      }
      function abort(reason) {
        if(error)return;
        error=reason instanceof Error?reason:failure(String(reason));
        try {tx.abort();} catch(_) {}
      }
      try {
        tx=db.transaction([...SOURCE_STORES,STAGE_STORE],'readwrite');
        tx.oncomplete=()=>{
          removeAbortListener();
          if(error)reject(error);
          else resolve({snapshotId,checkpointToken,generation,entries:copied,byStore:counts});
        };
        tx.onabort=()=>{
          removeAbortListener();
          reject(error||tx.error||failure('コピーが中断されました。'));
        };
        tx.onerror=()=>{if(!error)error=tx.error||failure('コピーに失敗しました。');};
        if(signal) {
          signal.addEventListener('abort',onAbort,{once:true});
          if(signal.aborted) {onAbort();return;}
        }
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
                    if(copied>=maxEntries)
                      throw failure('一時保存の件数が上限を超えました。');
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
        removeAbortListener();
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
    let previous=null,lastObserved=null,finished=false,seen=0;
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
            lastObserved=key;
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
    // Another tab can delete/recreate the same ID with an identical row
    // count AFTER the final data batch was read. The count alone cannot
    // detect this ABA race. Verify both total count and the last-read row's
    // snapshot token in ONE readonly transaction before returning success.
    const finalCheck=await new Promise((resolve,reject)=>{
      let tx,countReq,witnessReq;
      try {
        tx=db.transaction(STAGE_STORE,'readonly');
        tx.oncomplete=()=>resolve({
          count:countReq.result,witness:witnessReq.result
        });
        tx.onabort=()=>reject(tx.error||failure('最終照合が中断されました。'));
        tx.onerror=()=>{};
        const stage=tx.objectStore(STAGE_STORE);
        countReq=stage.count(rangeFor(snapshotId));
        witnessReq=stage.get(lastObserved);
      } catch(error) {reject(error);}
    });
    checkCancelled();
    if(finalCheck.count!==expectedEntries) {
      throw failure('一時保存の件数が読込み中に変更されました。');
    }
    if(!finalCheck.witness||
       finalCheck.witness.checkpointToken!==checkpointToken||
       finalCheck.witness.store!==lastObserved?.[1]||
       finalCheck.witness.key!==lastObserved?.[2]) {
      throw failure('最終照合で別のスナップショットを検出しました。');
    }
  }

  // Recover checkpoint IDs after a crash WITHOUT reading stored moth
  // images, DNA, Blob contents or even staged record values. A key cursor
  // jumps past each ID using the compound-key boundary [id, '\\uffff'].
  // This is a bounded discovery operation, never a delete/restore action.
  const MAX_DISCOVERY_IDS=64;
  function listCheckpointIds(db,{maxIds=MAX_DISCOVERY_IDS}={}) {
    if(!db?.objectStoreNames?.contains(STAGE_STORE)) {
      throw failure('一時保存用ストアが未準備です。既存DBは変更しません。');
    }
    if(!Number.isSafeInteger(maxIds)||maxIds<1||
       maxIds>MAX_DISCOVERY_IDS) {
      throw failure('診断できる一時保存ID数の指定が不正です。');
    }
    return new Promise((resolve,reject)=>{
      let tx,early=null;
      const ids=[];
      function abort(reason) {
        if(!early)early=reason instanceof Error?reason:failure(String(reason));
        try{tx.abort();}catch(_){}
      }
      try {
        tx=db.transaction(STAGE_STORE,'readonly');
        tx.oncomplete=()=>resolve(Object.freeze(ids.slice()));
        tx.onabort=()=>reject(early||tx.error||
          failure('一時保存IDの検索が中断されました。'));
        tx.onerror=()=>{if(!early)early=tx.error||
          failure('一時保存IDの検索に失敗しました。');};
        // Key-only cursors do not structured-clone huge Blob or genome
        // values. Jump over all records of one snapshot per cursor step.
        const req=tx.objectStore(STAGE_STORE).openKeyCursor();
        req.onerror=()=>abort(req.error||
          failure('一時保存IDのカーソルを開けません。'));
        req.onsuccess=()=>{
          if(early)return;
          const cursor=req.result;
          if(!cursor)return;
          const key=cursor.key;
          if(!Array.isArray(key)||key.length!==3||
             !validId(key[0])||!SOURCE_STORES.includes(key[1])||
             !validKey(key[2])) {
            abort(failure('一時保存IDのキー構造が不正です。'));return;
          }
          if(ids.length>=maxIds) {
            abort(failure('一時保存IDが検索上限を超えました。'));return;
          }
          if(ids.length&&ids[ids.length-1]>=key[0]) {
            abort(failure('一時保存IDの並び順が不正です。'));return;
          }
          ids.push(key[0]);
          try {
            // All source-store names are ASCII, strictly below U+FFFF.
            // The next key must belong to a different snapshot ID.
            cursor.continue([key[0],'\uffff']);
          }catch(e){abort(e);}
        };
      }catch(e){if(tx){early=e;try{tx.abort();}catch(_){reject(e);}}
        else reject(e);}
    });
  }

  // Read-only recovery inspection for a KNOWN snapshot ID after an app
  // crash. A process may have lost makeCheckpoint()'s returned token but
  // left a committed stage consuming storage. This reports only identity,
  // generation and counts: no source record values and NO automatic delete.
  // The returned token can be passed to the already token-guarded
  // discardCheckpoint() after an explicit decision to abandon this export.
  // If any row has a conflicting identity or malformed key, refuse cleanup.
  const MAX_INSPECT_ENTRIES=MAX_CHECKPOINT_ENTRIES;
  function inspectCheckpoint(db,snapshotId) {
    checkPrerequisites(db,snapshotId);
    return new Promise((resolve,reject)=>{
      let tx,early=null;
      let entries=0,checkpointToken=null,generation=null;
      const byStore={images:0,meta:0,theater_frames:0};
      function abort(reason) {
        if(!early)early=reason instanceof Error?reason:failure(String(reason));
        try{tx.abort();}catch(_){}
      }
      try {
        tx=db.transaction(STAGE_STORE,'readonly');
        tx.oncomplete=()=>resolve(entries===0?null:Object.freeze({
          snapshotId,checkpointToken,entries,
          byStore:Object.freeze({...byStore}),generation
        }));
        tx.onabort=()=>reject(early||tx.error||
          failure('一時保存の診断が中断されました。'));
        tx.onerror=()=>{if(!early)early=tx.error||
          failure('一時保存の診断に失敗しました。');};
        const req=tx.objectStore(STAGE_STORE).openCursor(rangeFor(snapshotId));
        req.onerror=()=>abort(req.error||failure('診断カーソルに失敗しました。'));
        req.onsuccess=()=>{
          if(early)return;
          const cursor=req.result;
          if(!cursor)return;
          const k=cursor.key,v=cursor.value;
          if(!Array.isArray(k)||k.length!==3||k[0]!==snapshotId||
             !SOURCE_STORES.includes(k[1])||!validKey(k[2])||
             !v||v.store!==k[1]||v.key!==k[2]||
             !Object.hasOwn(v,'value')||!TOKEN_RE.test(v.checkpointToken||'')) {
            abort(failure('一時保存内の識別情報が破損しています。'));return;
          }
          if(checkpointToken!==null&&checkpointToken!==v.checkpointToken) {
            abort(failure('同じIDに異なる一時保存が混在しています。'));return;
          }
          checkpointToken=v.checkpointToken;
          if(++entries>MAX_INSPECT_ENTRIES) {
            abort(failure('診断の上限件数を超えました。'));return;
          }
          byStore[v.store]++;
          if(v.store==='meta'&&v.key==='current_generation_id'&&
             typeof v.value==='string'&&GEN_RE.test(v.value)) {
            generation=v.value;
          }
          try{cursor.continue();}catch(e){abort(e);}
        };
      }catch(e){if(tx){early=e;try{tx.abort();}catch(_){reject(e);}}
        else reject(e);}
    });
  }

  // Deletes only rows belonging to the exact checkpoint incarnation.
  // A stale tab may finish late, after another tab has reused snapshotId.
  // Checking the token inside ONE readwrite transaction prevents it from
  // deleting any part of the new checkpoint. On mismatch, abort rolls back
  // even the deletes queued earlier in the same transaction.
  // Cleanup errors may leave temporary copies consuming quota, but never
  // erase source evolution data.
  function discardCheckpoint(db,snapshotId,checkpointToken) {
    checkPrerequisites(db,snapshotId);
    if(!TOKEN_RE.test(checkpointToken||''))
      throw failure('後片付けには一時保存識別子が必要です。');
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
            if(cursor.value?.checkpointToken!==checkpointToken) {
              throw failure('別のスナップショットを削除できません。');
            }
            cursor.delete();
            removed++;
            cursor.continue();
          } catch(e) {error=e;try{tx.abort();}catch(_){}}
        };
      }catch(e){if(tx){try{tx.abort();}catch(_){reject(e);}}else reject(e);}
    });
  }

  return Object.freeze({SOURCE_STORES,STAGE_STORE,MAX_CHECKPOINT_ENTRIES,makeCheckpoint,
    readCheckpoint,listCheckpointIds,inspectCheckpoint,discardCheckpoint});
});
