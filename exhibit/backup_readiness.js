/* EXH-02 / RE2-EXH-02: opt-in read-only backup readiness preflight.
 * Only checks metadata and keys. It NEVER exports/restores, modifies records,
 * upgrades a v2 database, or creates an empty one if a mode has not been played.
 * A green result does not guarantee that the 150 MiB v1 backup can be exported.
 */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.GitaiExhibitBackupReadiness=api;
})(typeof globalThis==='undefined'?this:globalThis,function(){
  'use strict';
  const STORES=Object.freeze(['images','meta','theater_frames']);
  const MAX_V1_ENTRIES=20000;
  const GEN=/^gen(?:\d{5}|[1-9]\d{5,})$/;
  const KEY_COUNT=60;
  function inspectDatabase(name,indexedDb){
    if(typeof name!=='string'||!/^gitai-exhibit-2026-[a-z0-9_-]{12,140}$/i.test(name)||
       !indexedDb||typeof indexedDb.open!=='function')
      return Promise.reject(Error('保存先または読み取り機能の指定が不正です。'));
    return new Promise((resolve,reject)=>{
      let settled=false,missingDb=false,blocked=false;
      const succeed=value=>{if(!settled){settled=true;resolve(value);}};
      const fail=error=>{if(!settled){settled=true;reject(error);}};
      let request;
      try{request=indexedDb.open(name);} // No version => never requests an upgrade.
      catch(error){fail(error);return;}
      request.onupgradeneeded=event=>{
        // The name did not exist: IndexedDB.open(name) would create a v1 DB.
        // Abort its creation transaction instead. No object stores are made.
        missingDb=true;
        try{event.target.transaction.abort();}
        catch(error){fail(error);}
      };
      request.onblocked=()=>{
        blocked=true;
        fail(Error('他のタブがデータベースを使用しています。ゲーム画面を閉じてください。'));
      };
      request.onerror=()=>{
        fail(missingDb
          ? Error('まだ実験データがありません。モードを一度プレイしてから確認してください。')
          : request.error||Error('データベースを読み取れませんでした。'));
      };
      request.onsuccess=()=>{
        const db=request.result;
        if(blocked){db.close();return;}
        // The inspector must not keep old connections open when a game asks
        // for an upgrade. No write transactions are ever started.
        db.onversionchange=()=>db.close();
        if(db.version!==2||STORES.some(store=>!db.objectStoreNames.contains(store))){
          db.close();
          fail(Error('保存データベースの形式が想定と異なります。内容は変更していません。'));
          return;
        }
        let tx;
        const counts=Object.create(null);
        let generation=null,missingImages=0,missingGenomes=0;
        const close=()=>{try{db.close();}catch(_){}};
        try{
          tx=db.transaction(STORES,'readonly');
          const images=tx.objectStore('images'),meta=tx.objectStore('meta');
          for(const store of STORES){
            const req=tx.objectStore(store).count();
            req.onsuccess=()=>{counts[store]=req.result;};
          }
          const current=meta.get('current_generation_id');
          current.onsuccess=()=>{
            generation=current.result;
            if(typeof generation!=='string'||!GEN.test(generation))return;
            // Fetch keys, not blobs/DNA: no large objects cross into JS.
            // Schedule all 120 requests while the same read-only transaction
            // is active, so counts and the current pointer are consistent.
            try{
              for(let i=1;i<=KEY_COUNT;i++){
                const suffix=String(i).padStart(2,'0');
                const image=images.getKey(generation+':'+suffix);
                image.onsuccess=()=>{if(image.result===undefined)missingImages++;};
                const dna=meta.getKey('genome:'+generation+':'+suffix);
                dna.onsuccess=()=>{if(dna.result===undefined)missingGenomes++;};
              }
            }catch(error){try{tx.abort();}catch(_){}fail(error);}
          };
          tx.oncomplete=()=>{
            close();
            const total=STORES.reduce((n,store)=>n+counts[store],0);
            const exists=typeof generation==='string'&&GEN.test(generation);
            const intact=exists&&missingImages===0&&missingGenomes===0;
            const tooMany=total>MAX_V1_ENTRIES;
            succeed(Object.freeze({
              generation:exists?generation:null,
              counts:Object.freeze({...counts}),total,
              missingImages,missingGenomes,
              status:!exists?'not-ready':!intact?'incomplete':tooMany?'v1-entry-limit':'eligible-for-v1-check',
              v1EntryLimit:MAX_V1_ENTRIES,
              // Only a preflight. PNG decoding, DNA semantics, node count and
              // serialized bytes are verified in the actual v1 exporter.
              exportVerified:false,
              readOnly:true
            }));
          };
          tx.onerror=()=>{};
          tx.onabort=()=>{
            close();
            fail(tx.error||Error('読み取り専用の保存確認が中断されました。'));
          };
        }catch(error){close();fail(error);}
      };
    });
  }
  async function inspect({name,indexedDb,storage}={}){
    const result=await inspectDatabase(name,indexedDb);
    let quota=null,usage=null;
    // Origin-wide estimate is informative ONLY, not a per-mode measurement.
    // Browser privacy settings may omit it entirely.
    try{
      if(storage&&typeof storage.estimate==='function'){
        const estimate=await storage.estimate();
        if(Number.isFinite(estimate?.quota)&&estimate.quota>=0)
          quota=Math.floor(estimate.quota);
        if(Number.isFinite(estimate?.usage)&&estimate.usage>=0)
          usage=Math.floor(estimate.usage);
      }
    }catch(_){}
    return Object.freeze({...result,originStorage:Object.freeze({usage,quota})});
  }
  function format(result,label){
    const n=result?.counts;
    if(!result?.readOnly||!n)throw Error('保存状況の診断結果が不正です。');
    const lines=[
      label+'：読み取り専用の診断結果',
      '現在の世代：'+(result.generation||'なし'),
      '保存項目：合計'+result.total+'件（画像'+n.images
        +'・世代/遺伝情報'+n.meta+'・進化シアター'+n.theater_frames+'）',
      '現在世代の不足：蛾画像'+result.missingImages+'件、DNA'+result.missingGenomes+'件'
    ];
    if(result.status==='not-ready')
      lines.push('このモードの実験データはまだありません。');
    else if(result.status==='incomplete')
      lines.push('注意：現在世代に不足があります。既存データを初期化しないでください。');
    else if(result.status==='v1-entry-limit')
      lines.push('注意：既存のJSONバックアップ上限20,000件を超えています。'
        +'現在の書き出しを試みず、データは消さずに保管してください。');
    else
      lines.push('項目数と現在世代の参照は確認できました。'
        +'JSONファイル容量・PNG/DNAの完全性は「書き出す」操作で別途検査します。'
        +'書き出し成功を保証するものではありません。');
    const {usage,quota}=result.originStorage||{};
    if(usage!==null&&quota!==null&&quota>0)
      lines.push('端末のサイト全体の保存容量（概算）：'
        +Math.round(usage/1048576)+' MiB / '
        +Math.round(quota/1048576)+' MiB ※両モード共通');
    lines.push('この診断はバックアップファイルを作成しません。'
      +'復元やデータの変更も行いません。');
    return lines.join('\n');
  }
  return Object.freeze({inspect,inspectDatabase,format,MAX_V1_ENTRIES});
});
